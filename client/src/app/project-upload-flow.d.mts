export declare function uploadThenOpenProject<T>(
  upload: () => Promise<T>,
  rememberProject: (project: T) => void,
  openProject: (project: T) => Promise<boolean | void>
): Promise<{ project: T; opened: boolean; openError: unknown | null }>;
