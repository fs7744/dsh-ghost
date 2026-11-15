import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type PeerAgent } from '@dsh-ghost/peer-agent';
/** 插件名。 */
export declare const name = "ghost-peers";
/** 依赖：工具注册表。 */
export declare const inject: string[];
/** 插件配置。 */
export interface Config {
    /** 状态目录（peer 清单放这里）。 */
    stateDir: string;
    /** 单个 peer 的默认超时（毫秒）。 */
    timeoutMs?: number;
}
/** 读 peer 清单（纯函数，便于测试）。 */
export declare function readPeers(dir: string): {
    peers: PeerAgent[];
    errors: Array<{
        id: string;
        errors: string[];
    }>;
};
/** 写 peer 清单：整份校验，非法项拒绝写入（不静默丢配置）。 */
export declare function savePeers(dir: string, peers: unknown): {
    ok: boolean;
    errors: string[];
    count: number;
};
/** 宿主 Remote 面（界面用）。 */
export declare class GhostPeersRemote extends TypertRemoteService {
    constructor(ctx: Context);
    /** peer 清单。 */
    list(input: {
        root?: string;
    }): {
        peers: PeerAgent[];
        errors: Array<{
            id: string;
            errors: string[];
        }>;
    };
    /** 保存 peer 清单。 */
    save(input: {
        peers: unknown;
        root?: string;
    }): {
        ok: boolean;
        errors: string[];
        count: number;
    };
}
/** 挂载插件。 */
export declare function apply(ctx: Context, config: Config): void;
