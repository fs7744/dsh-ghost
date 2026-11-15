import { type FileIo } from './io.ts';
import { type ConstraintDraft, type Occurrence, type Proposal, type ProposalKind } from './proposals.ts';
import { type Dashboard, type RunRecord } from './metrics.ts';
/** 构造服务的依赖，全部可注入（测试用内存 io）。 */
export interface EvolutionDeps {
    /** 提案与 runs.jsonl 的落盘目录。 */
    root: string;
    /** 写 L2 项目记忆的写入器（memory 提案批准时调用）。 */
    writeMemory?: (constraint: ConstraintDraft) => Promise<void> | void;
    now?: () => Date;
    makeId?: () => string;
    io?: FileIo;
}
/** ghostEvolution/propose 的输入。 */
export interface ProposeInput {
    kind?: ProposalKind;
    /** 错误/返工/节点的归一化标识，用于累积计数与生成 id。 */
    key: string;
    /** 本次带来的证据；缺省自动生成一条。 */
    occurrences?: Occurrence[];
    /** memory 提案要升的约束。 */
    constraint?: ConstraintDraft;
    title?: string;
    reason?: string;
    /** flow 提案的改动与度量。 */
    flow?: {
        nodeName: string;
        before: string;
        after: string;
        beforeMetrics: Record<string, number>;
        afterMetrics: Record<string, number>;
    };
    /** script 提案的脚本与连跑记录。 */
    script?: {
        path: string;
        content: string;
        runs: Array<{
            ok: boolean;
        }>;
    };
}
/** propose 结果。 */
export interface ProposeResult {
    proposal?: Proposal;
    created: boolean;
    /** 该 key 累计的返工次数。 */
    count: number;
}
/** approve / reject 结果。 */
export interface DecideResult {
    proposal: Proposal;
    applied: boolean;
    reason: string;
}
/** metrics 输入。 */
export interface MetricsInput {
    /** 要记录的一条 run（可选）。 */
    record?: RunRecord;
    /** 显式给的 before/after；缺省按时间把历史对半分。 */
    before?: RunRecord[];
    after?: RunRecord[];
}
/** metrics 结果：看板 + 已记录条数。 */
export interface MetricsResult extends Dashboard {
    recorded: number;
}
/** 决策输入。 */
export interface DecideInput {
    id: string;
    by?: string;
}
/** 进化服务的对外接口。 */
export interface EvolutionService {
    list(): Promise<Proposal[]>;
    propose(input: ProposeInput): Promise<ProposeResult>;
    approve(input: DecideInput): Promise<DecideResult>;
    reject(input: DecideInput): Promise<DecideResult>;
    rollback(input: DecideInput): Promise<{
        proposal: Proposal;
    }>;
    metrics(input: MetricsInput): Promise<MetricsResult>;
}
/** 组装一个进化服务。 */
export declare function createEvolutionService(deps: EvolutionDeps): EvolutionService;
