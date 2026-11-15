/**
 * 外部 agent（peer）协作：把 Claude / Codex / 豆包 / WorkBuddy 这类独立 agent 程序
 * 当成同事来协作（纯逻辑 + 执行适配）。
 */
export { buildA2ARequest, buildCliArgs, fetchAgentCard, normalizePeers, parseA2AOutput, parseHttpOutput, PEER_KINDS, runPeer, validatePeer, } from './peers.ts';
export type { PeerAgent, PeerKind, PeerResult } from './types.ts';
