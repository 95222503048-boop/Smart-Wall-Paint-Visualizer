export declare function describeApiError(error: unknown): Promise<{ message: string; status: number | null; requestPath: string; requestId: string }>;
export declare function isMissingOriginalImage(error: unknown): boolean;
