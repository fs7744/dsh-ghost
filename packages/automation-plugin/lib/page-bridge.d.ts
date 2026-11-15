/**
 * 「当前标签页」桥：让模型能操作**用户正在看的那个页面**（已登录、已打开）。
 *
 * 为什么需要：浏览器自动化的 Playwright 引擎跑在**独立临时画像**里——
 * 干净、安全，但看不见用户的登录态。想「点当前页面的查看新闻」「测一套考试系统」，
 * 必须驱动**当前标签页**，于是有了这条桥：
 *
 * ```
 * 模型 ──page_click/page_fill──▶ 宿主（排队一条命令）
 *                                  │
 * 扩展（chrome.debugger 挂在当前标签页）◀── 轮询取命令 ──┘
 *        │ 执行（Runtime.evaluate / Page.captureScreenshot）
 *        └── 回传结果 ──▶ 宿主 ──▶ 模型
 * ```
 *
 * 扩展是**主动轮询**方：宿主不能直接调用浏览器扩展（没有反向通道），
 * 所以命令进队列、扩展来取。模型侧的工具会等结果（有超时）。
 */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/** 页面快照（扩展采集）。 */
export interface PageSnapshot {
    url: string;
    title: string;
    /** 页面可见文本（截断）。 */
    text: string;
    /** 采集时间戳。 */
    at: number;
}
/** 扩展要执行的动作。 */
export interface PageCommand {
    id: string;
    /** 动作：click（按文本或选择器）、fill（填输入）、screenshot、read。 */
    action: 'click' | 'fill' | 'screenshot' | 'read';
    /** 目标：可见文本（click）或 CSS 选择器（fill）。 */
    target?: string;
    /** 填入的文本。 */
    value?: string;
    /** 截图保存目录（宿主给）。 */
    saveDir?: string;
}
/** 执行结果。 */
export interface PageCommandResult {
    id: string;
    ok: boolean;
    /** 人话结果。 */
    message: string;
    /** 截图文件路径（screenshot 动作，宿主写的）。 */
    path?: string;
    /** 截图原始数据（base64 PNG）；由宿主落盘。 */
    data?: string;
}
/** 当前活动页的 sessionId（没有扩展连着时为空串）。 */
export declare function activePageSessionId(): string;
/** 扩展是否在线（60 秒内轮询过）。 */
export declare function isBridgeOnline(sessionId: string, now?: number): boolean;
/** 上报快照（扩展侧调用；也是 Remote 的底层）。 */
export declare function registerSnapshot(sessionId: string, snapshot: PageSnapshot): void;
/**
 * 取一条待执行命令（扩展轮询）。
 * 注意：取走只是「在途」，命令仍在 inflight 里等结果——否则回传时找不到人可唤醒。
 */
export declare function takeCommand(sessionId: string): PageCommand | undefined;
/** 回传结果，唤醒等待中的模型工具。 */
export declare function completeCommand(sessionId: string, result: PageCommandResult): boolean;
/** 读当前页面快照。 */
export declare function readSnapshot(sessionId: string): {
    snapshot?: PageSnapshot;
    online: boolean;
};
/**
 * 宿主 Remote 面（扩展用）。
 */
export declare class GhostPageRemote extends TypertRemoteService {
    constructor(ctx: Context);
    /** 扩展上报页面快照。 */
    register(input: {
        sessionId: string;
        snapshot: PageSnapshot;
    }): {
        ok: boolean;
    };
    /** 扩展轮询命令（长轮询：最多等 20 秒）。 */
    next(input: {
        sessionId: string;
    }): Promise<{
        command?: PageCommand;
    }>;
    /** 扩展回传执行结果。 */
    result(input: {
        sessionId: string;
        result: PageCommandResult;
    }): {
        ok: boolean;
    };
    /** 读当前页面快照。 */
    read(input: {
        sessionId: string;
    }): {
        snapshot?: PageSnapshot;
        online: boolean;
    };
}
/**
 * 下发一条命令并等结果。
 * @param timeoutMs - 等待上限
 */
export declare function dispatchPageCommand(sessionId: string, command: Omit<PageCommand, 'id'>, timeoutMs?: number): Promise<PageCommandResult>;
