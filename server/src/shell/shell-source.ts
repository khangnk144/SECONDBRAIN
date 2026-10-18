/** Where the UI shell template comes from: web/dist in production, Vite in development. */
export interface ShellSource {
  /** Returns the index.html template, or null when the UI has not been built. */
  loadTemplate(url: string): Promise<string | null>;
}
