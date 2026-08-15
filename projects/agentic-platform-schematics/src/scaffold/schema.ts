export interface ScaffoldOptions {
  /** Target directory the workspace is scaffolded into. */
  directory?: string;
  /** Include the examples/ apps + MFE remotes. */
  includeExamples?: boolean;
  /** Overwrite files that already exist. */
  overwrite?: boolean;
}
