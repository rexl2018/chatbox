import fs from 'fs';
import chalk from 'chalk';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json using fs to avoid import assertion issues
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
const dependencies = packageJson.dependencies;

// Helper function to recursively find .node files in a directory
function findNodeFiles(dir) {
    const nodeFiles = [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                // Only search in common subdirectories to avoid performance issues
                if (['build', 'prebuilds', 'lib', 'bin'].includes(entry.name)) {
                    nodeFiles.push(...findNodeFiles(fullPath));
                }
            } else if (entry.isFile() && entry.name.endsWith('.node')) {
                nodeFiles.push(fullPath);
            }
        }
    } catch (e) {
        // Ignore permission errors or missing directories
    }
    return nodeFiles;
}

if (dependencies) {
    const dependenciesKeys = Object.keys(dependencies);
    
    // Packages to exclude from native dependency check
    const excludePackages = ['capacitor-stream-http']; // Capacitor plugins are not native Electron dependencies
    
    // Check for packages with binding.gyp (source-based native modules)
    const nativeDepsByBindingGyp = fs
        .readdirSync('node_modules')
        .filter((folder) => !excludePackages.includes(folder) && fs.existsSync(`node_modules/${folder}/binding.gyp`));
    
    // Check for packages with .node files (precompiled native modules)
    const nativeDepsByNodeFiles = fs
        .readdirSync('node_modules')
        .filter((folder) => {
            if (excludePackages.includes(folder)) return false;
            const nodeFiles = findNodeFiles(`node_modules/${folder}`);
            return nodeFiles.length > 0;
        });
    
    // Combine both types of native dependencies
    const allNativeDeps = [...new Set([...nativeDepsByBindingGyp, ...nativeDepsByNodeFiles])];

    if (allNativeDeps.length > 0) {
        const deps = allNativeDeps.join(', ');
        console.log(`Found native dependencies: ${chalk.yellow(deps)}`);
    
        const bindingGypDeps = nativeDepsByBindingGyp.join(', ');
        if (bindingGypDeps) {
          console.log(`- With binding.gyp: ${chalk.yellow(bindingGypDeps)}`);
        }
    
        const nodeFileDeps = nativeDepsByNodeFiles.join(', ');
        if (nodeFileDeps) {
          console.log(`- With .node files: ${chalk.yellow(nodeFileDeps)}`);
        }
    
        try {
          // Find the electron-rebuild binary.
          const electronRebuildPath = path.resolve(
            __dirname,
            '../../node_modules/.bin/electron-rebuild'
          );
    
          if (fs.existsSync(electronRebuildPath)) {
            // TODO: find a better way to fix this
            // execSync(`'${electronRebuildPath}'`);
          } else {
            console.log('Could not find electron-rebuild script.');
          }
        } catch (error) {
          console.log(
            `Could not rebuild native dependencies: ${chalk.red(error)}`
          );
        }
      }
}
