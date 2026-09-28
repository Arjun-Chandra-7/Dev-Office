// Debug helper: print every process the Claude detector considers a session.
import { initProcInfo, scanClaudeProcesses } from '../server/claude.ts';

await initProcInfo();
for (const p of scanClaudeProcesses())
  console.log(p.pid, p.kind, p.cwd, JSON.stringify(p.argv.slice(0, 3)), p.sessionFile ? `file:${p.sessionFile.status}${p.sessionFile.spare ? ' spare' : ''}` : 'no-file');
