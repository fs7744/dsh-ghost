/** 进化模块需要的最小文件系统能力。 */
export interface FileIo {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    append(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    /** 列出目录下的直接子项名字（目录不存在返回空数组）。 */
    list(dir: string): Promise<string[]>;
}
/** 真实磁盘实现（默认）。 */
export declare function nodeFileIo(): FileIo;
/** 内存实现：测试用，`files` 暴露出来便于断言「驳回不落盘」。 */
export interface MemoryFileIo extends FileIo {
    files: Map<string, string>;
}
/** 构造内存 IO，可给一份初始文件表。 */
export declare function memoryFileIo(initial?: Readonly<Record<string, string>>): MemoryFileIo;
