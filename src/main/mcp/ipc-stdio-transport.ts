// 和 renderer/packages/mcp/ipc-stdio-transport.ts 配套的main进程ipc handler

import { StdioClientTransport, StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import chardet from 'chardet'
import { ipcMain } from 'electron'
import iconv from 'iconv-lite'
import { isEmpty } from 'lodash'
import { v4 as uuidv4 } from 'uuid'
import { getLogger } from '../util'
import * as shellEnvModule from './shell-env'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
const shellEnv: (shell?: string) => Promise<Record<string, string>> =
  ((shellEnvModule as any)?.shellEnv || (shellEnvModule as any)?.default || (shellEnvModule as any)) as any

/**
 * 获取 macOS 常见工具链路径的兜底列表
 */
function getCommonToolPaths(): string[] {
  const paths = [
    '/opt/homebrew/bin',      // Apple Silicon Homebrew
    '/usr/local/bin',         // Intel Homebrew / 手动安装
    '/opt/homebrew/sbin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ]

  // 添加用户特定路径
  const userHome = homedir()
  const userPaths = [
    join(userHome, '.local/bin'),
    join(userHome, 'bin'),
    join(userHome, '.cargo/bin'),     // Rust
    join(userHome, 'go/bin'),         // Go
    join(userHome, '.npm-global/bin'), // npm global
  ]

  // 检查常见的 Node.js 版本管理器路径
  const nodeManagerPaths = [
    join(userHome, '.nvm/versions/node'),
    join(userHome, '.asdf/shims'),
    join(userHome, '.volta/bin'),
    join(userHome, '.fnm'),
  ]

  // 对于 nvm，尝试找到当前版本
  const nvmCurrentPath = join(userHome, '.nvm/versions/node')
  if (existsSync(nvmCurrentPath)) {
    try {
      const fs = require('fs')
      const versions = fs.readdirSync(nvmCurrentPath)
      if (versions.length > 0) {
        // 取最新版本（简单按字符串排序）
        const latestVersion = versions.sort().pop()
        nodeManagerPaths.push(join(nvmCurrentPath, latestVersion, 'bin'))
      }
    } catch (err) {
      // 忽略读取错误
    }
  }

  return [...paths, ...userPaths, ...nodeManagerPaths].filter(path => existsSync(path))
}

/**
 * 合并和去重 PATH 环境变量
 */
function mergePaths(existingPath: string = '', additionalPaths: string[]): string {
  const pathSeparator = process.platform === 'win32' ? ';' : ':'
  const existingPaths = existingPath.split(pathSeparator).filter(Boolean)
  const allPaths = [...existingPaths, ...additionalPaths]
  
  // 去重，保持顺序
  const uniquePaths = Array.from(new Set(allPaths))
  return uniquePaths.join(pathSeparator)
}

async function enhanceEnv(configEnv?: Record<string, string>) {
  let env: Record<string, string> = {}
  
  // 首先尝试从 shell 获取环境变量
  try {
    if (typeof shellEnv === 'function') {
      env = (await shellEnv()) || {}
      logger.info('Successfully loaded shell environment')
    } else {
      logger.warn('shell-env module unavailable or not a function, using fallback')
    }
  } catch (err) {
    logger.error('shell-env failed, using fallback:', err)
  }

  // 如果 shell-env 失败或返回空，使用 process.env 作为基础
  if (isEmpty(env)) {
    env = { ...process.env }
    logger.info('Using process.env as base environment')
  }

  // 增强 PATH：添加常见工具链路径
  const commonPaths = getCommonToolPaths()
  if (commonPaths.length > 0) {
    env.PATH = mergePaths(env.PATH, commonPaths)
    logger.info(`Enhanced PATH with ${commonPaths.length} additional paths:`, commonPaths)
  }

  // 合并用户配置的环境变量
  if (configEnv) {
    env = { ...env, ...configEnv }
  }

  return isEmpty(env) ? undefined : env
}

const logger = getLogger('mcp:stdio-transport')

const transportMap = new Map<string, StdioClientTransport>()

function getTransport(transportId: string) {
  const transport = transportMap.get(transportId)
  if (!transport) {
    throw new Error(`Transport ${transportId} not found`)
  }
  return transport
}

ipcMain.handle('mcp:stdio-transport:create', async (event, serverParams: StdioServerParameters) => {
  logger.info('create', serverParams)

  const postMessage = (channel: string, ...args: any[]) => {
    try {
      event.sender.send(channel, ...args)
    } catch (err) {
      logger.error('postMessage error', channel, err)
    }
  }

  const env = await enhanceEnv(serverParams.env)
  const transport = new StdioClientTransport({
    command: serverParams.command,
    args: serverParams.args,
    env,
    stderr: 'pipe',
  })

  let stderrMessage = ''
  transport.stderr?.addListener('data', (data: Buffer) => {
    const encoding = chardet.detect(new Uint8Array(data))
    const text = iconv.decode(data, encoding || 'utf-8')
    logger.debug('mcp stderr', text)
    stderrMessage += text
  })

  const transportId = uuidv4()
  transport.onclose = () => {
    logger.info('onclose', transportId)
    transport.stderr?.removeAllListeners()
    postMessage(`mcp:stdio-transport:${transportId}:onclose`, stderrMessage)
    transportMap.delete(transportId)
  }
  transport.onerror = (error) => {
    logger.error('onerror', transportId, error)
    postMessage(`mcp:stdio-transport:${transportId}:onerror`, error)
  }
  transport.onmessage = (message) => {
    logger.info('onmessage', transportId, message)
    postMessage(`mcp:stdio-transport:${transportId}:onmessage`, message)
  }
  transportMap.set(transportId, transport)
  return transportId
})

ipcMain.handle('mcp:stdio-transport:start', async (_event, transportId: string) => {
  logger.info('start', transportId)
  const transport = getTransport(transportId)
  await transport.start()
})

ipcMain.handle('mcp:stdio-transport:send', async (_event, transportId: string, message: JSONRPCMessage) => {
  logger.info('send', transportId, message)
  const transport = getTransport(transportId)
  await transport.send(message)
})

ipcMain.handle('mcp:stdio-transport:close', async (_event, transportId: string) => {
  logger.info('close', transportId)
  const transport = getTransport(transportId)
  await transport.close()
  transportMap.delete(transportId)
})

export function closeAllTransports() {
  for (const [id, transport] of transportMap.entries()) {
    transport.close().catch((err) => {
      logger.error('close stdio transport', id, err)
    })
  }
}
