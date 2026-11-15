import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/** 插件名。 */
export declare const name = "ghost-automation";
/** 依赖：工具注册表。 */
export declare const inject: string[];
/** 插件配置。 */
export interface Config {
    /** 状态文件目录（放开关状态与截图）。 */
    stateDir: string;
    /** 工作区目录（截图落到工作区，模型才能用 read_image 看到）。 */
    workspaceDir?: string;
    /** 浏览器是否无头运行（默认可见）。 */
    headless?: boolean;
    /** 允许访问的站点白名单；为空表示不限制（用户已显式开启）。 */
    allowHosts?: string[];
}
interface AutomationState {
    browser: boolean;
    computer: boolean;
}
/** 宿主 Remote 面（界面用）。 */
export declare class GhostAutomationRemote extends TypertRemoteService {
    constructor(ctx: Context);
    /** 状态：开关 + 本机能力探测。 */
    status(input: {
        root?: string;
    }): {
        browser: {
            enabled: boolean;
            available: boolean;
            executable?: string;
            name?: string;
        };
        computer: {
            enabled: boolean;
            available: boolean;
            platform: string;
        };
    };
    /** 开关：只接受 boolean。 */
    setEnabled(input: {
        browser?: boolean;
        computer?: boolean;
        root?: string;
    }): AutomationState;
}
/**
 * 挂载插件。
 */
export declare function apply(ctx: Context, config: Config): void;
export {};
