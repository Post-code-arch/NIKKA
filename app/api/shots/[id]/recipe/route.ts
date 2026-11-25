import { handle, json, parseBody } from "@/lib/api/http";
import { RecipeRequest } from "@/lib/api/inputs";
import { applyRecipe } from "@/lib/graph/run";

type Ctx = { params: Promise<{ id: string }> };

/** Rebuilds the shot's graph from a recipe. Takes are kept. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { recipeId } = await parseBody(req, RecipeRequest);
  return json(applyRecipe((await params).id, recipeId));
});
