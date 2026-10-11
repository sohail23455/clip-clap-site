import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('local Admin API script verifies the existing owner and safely updates only the password',{skip:process.platform!=='win32'},()=>{
 const output=execFileSync('pwsh',['-NoProfile','-File',fileURLToPath(new URL('./owner-password-script.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true});
 assert.match(output,/8 secure owner-password script checks passed/);
});
