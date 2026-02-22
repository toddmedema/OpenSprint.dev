declare module "turndown" {
  interface TurndownOptions {
    headingStyle?: "setext" | "atx";
    codeBlockStyle?: "indented" | "fenced";
  }
  export default class TurndownService {
    constructor(options?: TurndownOptions);
    turndown(html: string): string;
  }
}
