import type { Skill, SkillSearchResult } from "@nonclaw-ui/shared/types";

export interface ISkillService {
  list(): Promise<Skill[]>;
  search(query: string): Promise<SkillSearchResult[]>;
}
