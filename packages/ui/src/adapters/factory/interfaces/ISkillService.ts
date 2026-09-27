import type { Skill, SkillSearchResult } from "@eigen-air-ui/shared/types";

export interface ISkillService {
  list(): Promise<Skill[]>;
  search(query: string): Promise<SkillSearchResult[]>;
}
