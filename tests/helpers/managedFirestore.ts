import { z } from "zod";

export const MANAGED_FIRESTORE_WRITE_ACKNOWLEDGEMENT =
  "I_ACKNOWLEDGE_COUNTERSTEP_MANAGED_FIRESTORE_WRITES" as const;

const ProjectIdSchema = z
  .string()
  .min(6)
  .max(30)
  .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/);

const ManagedFirestoreEvidenceConfigSchema = z
  .object({
    projectId: ProjectIdSchema,
    confirmedProjectId: ProjectIdSchema,
    databaseId: z.literal("(default)"),
    runLabel: z
      .string()
      .min(8)
      .max(48)
      .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/),
    writeAcknowledgement: z.literal(
      MANAGED_FIRESTORE_WRITE_ACKNOWLEDGEMENT,
    ),
    emulatorHost: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.projectId !== value.confirmedProjectId) {
      context.addIssue({
        code: "custom",
        path: ["confirmedProjectId"],
        message: "Managed Firestore project confirmation does not match.",
      });
    }
    if (value.projectId.startsWith("demo-")) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Managed Firestore evidence cannot use a demo project ID.",
      });
    }
    if (value.emulatorHost) {
      context.addIssue({
        code: "custom",
        path: ["emulatorHost"],
        message: "Managed Firestore evidence refuses emulator fallback.",
      });
    }
  });

export type ManagedFirestoreEvidenceConfig = z.infer<
  typeof ManagedFirestoreEvidenceConfigSchema
>;

export function parseManagedFirestoreEvidenceConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ManagedFirestoreEvidenceConfig {
  return ManagedFirestoreEvidenceConfigSchema.parse({
    projectId: environment.COUNTERSTEP_MANAGED_FIRESTORE_PROJECT,
    confirmedProjectId:
      environment.COUNTERSTEP_MANAGED_FIRESTORE_CONFIRM_PROJECT,
    databaseId:
      environment.COUNTERSTEP_MANAGED_FIRESTORE_DATABASE_ID ?? "(default)",
    runLabel: environment.COUNTERSTEP_MANAGED_FIRESTORE_RUN_LABEL,
    writeAcknowledgement:
      environment.COUNTERSTEP_MANAGED_FIRESTORE_WRITE_ACK,
    emulatorHost: environment.FIRESTORE_EMULATOR_HOST,
  });
}
