import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type PanelManifest, type SlotContribution } from '@dsh-ghost/ui-extensions';
import { type ProviderSpec } from '@dsh-ghost/model-manager';
/** 插件名。 */
export declare const name = "ghost-ui";
/** 依赖：工具注册表必需（与其它插件同口径）。 */
export declare const inject: string[];
/** 插件配置。 */
export interface Config {
    /** 扩展根目录：默认 `<workspace>/.ghost/ui`。 */
    root: string;
}
/** 宿主侧可见的扩展内容。 */
export interface UiExtensionSnapshot {
    panels: PanelManifest[];
    slots: SlotContribution[];
    panelErrors: Array<{
        id: string;
        errors: string[];
    }>;
    slotErrors: Array<{
        id: string;
        errors: string[];
    }>;
}
/** 编程注册一个面板（其它插件用）。 */
export declare function registerPanel(manifest: PanelManifest): void;
/** 编程注册一条插槽贡献（其它插件用）。 */
export declare function registerSlot(slot: SlotContribution): void;
/** 读面板清单（纯函数，测试直接用）。 */
export declare function readPanels(root: string): {
    panels: PanelManifest[];
    errors: Array<{
        id: string;
        errors: string[];
    }>;
};
/** 读插槽贡献（纯函数）。 */
export declare function readSlots(root: string): {
    slots: SlotContribution[];
    errors: Array<{
        id: string;
        errors: string[];
    }>;
};
/** 读已登记的 provider（纯函数）。 */
export declare function readProviders(root: string): {
    providers: ProviderSpec[];
    errors: string[];
};
/** 写 provider 规格：先校验，再原子写盘（纯函数）。 */
export declare function saveProviders(root: string, providers: ProviderSpec[]): {
    ok: boolean;
    errors: string[];
    count: number;
};
/** 宿主 Remote 面。 */
export declare class GhostUiRemote extends TypertRemoteService {
    constructor(ctx: Context);
    /** 所有面板清单（含编程注册的）。 */
    panels(input: {
        root?: string;
    }): {
        panels: PanelManifest[];
        errors: Array<{
            id: string;
            errors: string[];
        }>;
    };
    /** 所有插槽贡献（含编程注册的）。 */
    slots(input: {
        root?: string;
    }): {
        slots: SlotContribution[];
        errors: Array<{
            id: string;
            errors: string[];
        }>;
    };
    /** 已登记的 LLM 服务（provider 规格）。 */
    providers(input: {
        root?: string;
    }): {
        providers: ProviderSpec[];
        errors: string[];
    };
    /**
     * 登记 LLM 服务：先过校验，再原子写盘。
     * 写完**下次启动宿主**生效（渲染 profile 时会把它写进 llm-pi-ai.providers）。
     */
    providersSave(input: {
        providers: ProviderSpec[];
        root?: string;
    }): {
        ok: boolean;
        errors: string[];
        count: number;
    };
}
/**
 * 挂载插件。
 * @param ctx - cordis 上下文
 * @param config - 扩展根目录
 */
export declare function apply(ctx: Context, config: Config): void;
