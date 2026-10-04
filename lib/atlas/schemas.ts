import { z } from "zod";

/** Response of POST /model/generateImage and /model/generateVideo. */
export const SubmitResponseSchema = z.looseObject({
  code: z.union([z.number(), z.string()]).optional(),
  data: z.looseObject({
    id: z.string().min(1),
    status: z.string().optional(),
  }),
});
export type SubmitResponse = z.infer<typeof SubmitResponseSchema>;

/** Statuses documented by Atlas; unknown values are kept as strings. */
export const SUCCESS_STATUSES = new Set(["completed", "succeeded"]);
export const FAILURE_STATUSES = new Set([
  "failed",
  "canceled",
  "cancelled",
  "error",
  "timeout",
]);

const OutputItemSchema = z.union([
  z.string(),
  z.looseObject({ url: z.string().optional() }),
]);

export const PredictionDataSchema = z.looseObject({
  id: z.string().optional(),
  model: z.string().optional(),
  status: z.string(),
  outputs: z.array(OutputItemSchema).nullish(),
  output: z.union([z.string(), z.array(z.string())]).nullish(),
  error: z.unknown().optional(),
  price: z.union([z.string(), z.number()]).nullish(),
  created_at: z.string().nullish(),
  completed_at: z.string().nullish(),
});
export type PredictionData = z.infer<typeof PredictionDataSchema>;

export const PredictionResponseSchema = z.looseObject({
  code: z.union([z.number(), z.string()]).optional(),
  message: z.string().optional(),
  data: PredictionDataSchema,
});

/** Response of POST /model/uploadMedia. */
export const UploadResponseSchema = z.looseObject({
  code: z.union([z.number(), z.string()]).optional(),
  data: z.looseObject({
    download_url: z.string().url(),
    filename: z.string().optional(),
    size: z.number().optional(),
    type: z.string().optional(),
  }),
});

const PriceSideSchema = z.looseObject({
  input_price: z.string().optional(),
  output_price: z.string().optional(),
  base_price: z.string().optional(),
  output_image_price: z.string().optional(),
  request_price: z.string().optional(),
  unit: z.string().optional(),
});

/** One entry of GET /models (public catalog). */
export const CatalogModelSchema = z.looseObject({
  model: z.string(),
  type: z.string(),
  displayName: z.string().optional(),
  schema: z.string().nullish(),
  readme: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  categories: z.array(z.string()).nullish(),
  display_console: z.boolean().optional(),
  price: z
    .looseObject({
      actual: PriceSideSchema.optional(),
      origin: PriceSideSchema.optional(),
    })
    .nullish(),
  minDuration: z.number().nullish(),
});
export type CatalogModel = z.infer<typeof CatalogModelSchema>;

export const CatalogResponseSchema = z.looseObject({
  code: z.union([z.number(), z.string()]).optional(),
  data: z.array(CatalogModelSchema),
});

/** JSON-schema-ish property as found in the model OpenAPI docs. */
export const SchemaPropertySchema = z.looseObject({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  enum: z.array(z.unknown()).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  items: z.unknown().optional(),
});
export type SchemaProperty = z.infer<typeof SchemaPropertySchema>;

export const ModelInputSchemaSchema = z.looseObject({
  properties: z.record(z.string(), SchemaPropertySchema),
  required: z.array(z.string()).optional(),
});
export type ModelInputSchema = z.infer<typeof ModelInputSchemaSchema>;

/** Minimal shape of an OpenAI-compatible chat completion we rely on. */
export const ChatCompletionSchema = z.looseObject({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z
    .array(
      z.looseObject({
        message: z.looseObject({
          role: z.string(),
          content: z.string().nullable(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .looseObject({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .nullish(),
});
