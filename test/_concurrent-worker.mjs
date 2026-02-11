import { saveRefs } from '../src/refs.js';
const [,, port, targetId, agentId, workerId, numWrites] = process.argv;
for (let i = 0; i < parseInt(numWrites); i++) {
  saveRefs(parseInt(port), targetId, {
    e1: { backendDOMNodeId: parseInt(workerId) * 1000 + i, role: 'button', name: 'W' + workerId + '-' + i },
    e2: { backendDOMNodeId: parseInt(workerId) * 1000 + i + 1, role: 'link', name: 'Link' },
  }, agentId);
}
