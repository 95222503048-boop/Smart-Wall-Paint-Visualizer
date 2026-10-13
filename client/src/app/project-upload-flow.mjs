/** Saves the project exactly once, then treats editor opening as a separate step. */
export async function uploadThenOpenProject(upload, rememberProject, openProject) {
  const project = await upload();
  rememberProject(project);
  try {
    const opened = await openProject(project);
    return { project, opened: opened !== false, openError: null };
  } catch (openError) {
    return { project, opened: false, openError };
  }
}
