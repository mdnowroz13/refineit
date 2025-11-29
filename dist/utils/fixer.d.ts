import { UnusedImport } from './analyzer.js';
export interface FixResult {
    file: string;
    removedNamedImports: string[];
    removedDefaultImport?: string | null;
    success: boolean;
    error?: string | null;
}
export declare function fixImports(unusedImports: UnusedImport[]): Promise<FixResult[]>;
export default fixImports;
//# sourceMappingURL=fixer.d.ts.map