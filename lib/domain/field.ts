import { z } from "zod";

/** Origin of a piece of information (PRD §1 principle 5). */
export const OriginSchema = z.enum(["extracted", "proposed", "validated"]);
export type Origin = z.infer<typeof OriginSchema>;

export function fieldSchema<T extends z.ZodType>(value: T) {
  return z.object({ value, origin: OriginSchema });
}

export type Field<T> = { value: T; origin: Origin };

/** A value typed by the user is validated by definition. */
export function userField<T>(value: T): Field<T> {
  return { value, origin: "validated" };
}
