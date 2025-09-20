import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import webpackPaths from '../configs/webpack.paths.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json using fs to avoid import assertion issues
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../release/app/package.json'), 'utf-8'));
const dependencies = packageJson.dependencies;

if (Object.keys(dependencies || {}).length > 0 && fs.existsSync(webpackPaths.appNodeModulesPath)) {
    const electronRebuildCmd =
        '../../node_modules/.bin/electron-rebuild --force --types prod,dev,optional --module-dir .';
    const cmd = process.platform === 'win32' ? electronRebuildCmd.replace(/\//g, '\\') : electronRebuildCmd;
    execSync(cmd, {
        cwd: webpackPaths.appPath,
        stdio: 'inherit',
    });
}
