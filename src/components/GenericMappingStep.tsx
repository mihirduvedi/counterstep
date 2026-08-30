import type { GenericJsonInspection } from "../adapters/genericJson";
import type { CanonicalOperation } from "../core/schemas/index";
import {
  ALL_OPERATIONS,
  formatCountLabel,
} from "../ui/receiptView";
import {
  changeGenericRecordSet,
  collectGenericSemanticValues,
} from "../ui/genericMappingView";
import type {
  GenericJsonMappingDraft,
  GenericMappingValidation,
} from "../ui/genericMappingView";

type Props = {
  source: { label: string; bytes: Uint8Array };
  document: unknown;
  inspection: GenericJsonInspection;
  draft: GenericJsonMappingDraft;
  validation: GenericMappingValidation;
  onDraftChange: (draft: GenericJsonMappingDraft) => void;
  onBack: () => void;
  onContinue: () => void;
};

export function GenericMappingStep(props: Props) {
  const selectedRecordSet = props.inspection.recordSets.find(
    (recordSet) => recordSet.pointer === props.draft.recordsPointer,
  );
  const fields = selectedRecordSet?.fieldPointers ?? [];
  const mutate = (change: (next: GenericJsonMappingDraft) => void) => {
    const next = structuredClone(props.draft);
    change(next);
    props.onDraftChange(next);
  };
  const semanticValues = {
    operations: collectGenericSemanticValues(
      props.document,
      props.draft.recordsPointer,
      props.draft.fields.operation,
    ),
    statuses: collectGenericSemanticValues(
      props.document,
      props.draft.recordsPointer,
      props.draft.fields.status,
    ),
    stateChanges: collectGenericSemanticValues(
      props.document,
      props.draft.recordsPointer,
      props.draft.fields.stateChange,
    ),
    actorTypes:
      props.draft.fields.actorTypeMode === "path"
        ? collectGenericSemanticValues(
            props.document,
            props.draft.recordsPointer,
            props.draft.fields.actorType,
          )
        : [],
    boundaries: collectGenericSemanticValues(
      props.document,
      props.draft.recordsPointer,
      props.draft.fields.destinationBoundary,
    ),
  };

  return (
    <div className="mapping-layout">
      <aside className="mapping-context">
        <button className="back-button" type="button" onClick={props.onBack}>
          ← Back to trace
        </button>
        <p className="section-number">Step 02 · Explicit mapping</p>
        <h1>Tell the receipt what this log means.</h1>
        <p>
          Structural suggestions are a head start only. Review every path and
          translate each observed value before it becomes evidence.
        </p>
        <dl className="source-facts">
          <div><dt>Source</dt><dd>{props.source.label}</dd></div>
          <div><dt>Record sets</dt><dd>{props.inspection.recordSets.length}</dd></div>
          <div><dt>File size</dt><dd>{props.source.bytes.byteLength.toLocaleString()} bytes</dd></div>
        </dl>
        <div className="mapping-trust-note">
          <strong>No model inference</strong>
          <p>
            Original bytes remain unchanged. The mapping manifest is retained
            with the receipt so every interpretation stays inspectable.
          </p>
        </div>
      </aside>

      <section className="mapping-form-shell" aria-labelledby="mapping-title">
        <div className="section-heading mapping-heading">
          <div>
            <p className="section-number">Generic JSON adapter</p>
            <h2 id="mapping-title">Map records into receipt evidence</h2>
          </div>
          <span className={props.validation.ok ? "validity valid" : "validity invalid"}>
            {props.validation.ok ? "Preview ready" : "Mapping incomplete"}
          </span>
        </div>

        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            props.onContinue();
          }}
        >
          <fieldset className="mapping-section mapping-record-set">
            <legend>1. Choose the action records</legend>
            <p>
              Every item in this array will be mapped or marked
              material-unparsed. Nothing is silently dropped.
            </p>
            <label>
              <span>Record array</span>
              <select
                name="generic-record-set"
                value={props.draft.recordsPointer}
                onChange={(event) =>
                  props.onDraftChange(
                    changeGenericRecordSet(
                      props.document,
                      props.inspection,
                      props.draft,
                      event.target.value,
                    ),
                  )
                }
              >
                {props.inspection.recordSets.map((recordSet) => (
                  <option key={recordSet.pointer} value={recordSet.pointer}>
                    {recordSet.label} · {recordSet.recordCount} {formatCountLabel(recordSet.recordCount, "record")}
                  </option>
                ))}
              </select>
            </label>
            <p className="mapping-selection-summary">
              {selectedRecordSet?.recordCount ?? 0} records · {fields.length} discovered fields
            </p>
          </fieldset>

          <RunMappingFields draft={props.draft} mutate={mutate} />
          <CoreMappingFields
            draft={props.draft}
            fields={fields}
            mutate={mutate}
          />
          <SemanticMappingFields
            draft={props.draft}
            values={semanticValues}
            mutate={mutate}
          />
          <AdvancedMappingFields
            draft={props.draft}
            fields={fields}
            boundaryValues={semanticValues.boundaries}
            mutate={mutate}
          />
          <MappingPreview validation={props.validation} />

          <div className="form-submit-row mapping-submit-row">
            <p>
              Continue only after these paths and value meanings match the
              exporter&rsquo;s real contract.
            </p>
            <button
              className="primary-button"
              type="submit"
              disabled={!props.validation.ok}
              aria-describedby={!props.validation.ok ? "mapping-disabled-reason" : undefined}
            >
              Confirm mapping and set authority
            </button>
          </div>
          {!props.validation.ok ? (
            <p className="sr-only" id="mapping-disabled-reason">
              Complete required fields and map at least one record first.
            </p>
          ) : null}
        </form>
      </section>
    </div>
  );
}

type Mutate = (change: (next: GenericJsonMappingDraft) => void) => void;

function RunMappingFields(props: {
  draft: GenericJsonMappingDraft;
  mutate: Mutate;
}) {
  return (
    <fieldset className="mapping-section">
      <legend>2. Describe the completed run</legend>
      <p>
        Enter only facts established by the log source or its export context.
      </p>
      <div className="form-grid two-column mapping-run-grid">
        <TextField
          name="generic-trace-id"
          label="Trace or run ID"
          value={props.draft.run.traceId}
          onChange={(value) => props.mutate((next) => { next.run.traceId = value; })}
        />
        <TextField
          name="generic-agent-id"
          label="Agent ID"
          value={props.draft.run.agentId}
          onChange={(value) => props.mutate((next) => { next.run.agentId = value; })}
        />
        <TextField
          name="generic-agent-name"
          label="Agent name"
          optional
          value={props.draft.run.agentName}
          onChange={(value) => props.mutate((next) => { next.run.agentName = value; })}
        />
        <TextField
          name="generic-agent-version"
          label="Agent version"
          optional
          value={props.draft.run.agentVersion}
          onChange={(value) => props.mutate((next) => { next.run.agentVersion = value; })}
        />
        <TextField
          name="generic-started-at"
          label="Started at"
          value={props.draft.run.startedAt}
          placeholder="2026-08-28T18:00:00Z"
          describedBy="generic-time-help"
          onChange={(value) => props.mutate((next) => { next.run.startedAt = value; })}
        />
        <TextField
          name="generic-completed-at"
          label="Completed at"
          optional
          value={props.draft.run.completedAt}
          placeholder="2026-08-28T18:05:00Z"
          describedBy="generic-time-help"
          onChange={(value) => props.mutate((next) => { next.run.completedAt = value; })}
        />
        <label>
          <span>Run status</span>
          <select
            name="generic-run-status"
            value={props.draft.run.status}
            onChange={(event) =>
              props.mutate((next) => {
                next.run.status = event.target.value as GenericJsonMappingDraft["run"]["status"];
              })
            }
          >
            <option value="">Choose status</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
            <option value="unknown">Unknown / not established</option>
          </select>
        </label>
      </div>
      <p id="generic-time-help" className="mapping-help">
        Use RFC 3339 with an explicit timezone. If completion is not
        established, leave completed time blank and choose Unknown.
      </p>
    </fieldset>
  );
}

function CoreMappingFields(props: {
  draft: GenericJsonMappingDraft;
  fields: string[];
  mutate: Mutate;
}) {
  return (
    <fieldset className="mapping-section">
      <legend>3. Map the minimum event facts</legend>
      <p>
        Common field names may be suggested, but the mapping remains inactive
        until you confirm this form.
      </p>
      <div className="mapping-field-grid">
        <FieldPointerSelect id="generic-event-id" label="Event ID" optional value={props.draft.fields.sourceEventId} fields={props.fields} onChange={(value) => props.mutate((next) => { next.fields.sourceEventId = value; })} />
        <FieldPointerSelect id="generic-timestamp" label="Timestamp" value={props.draft.fields.timestamp} fields={props.fields} onChange={(value) => props.mutate((next) => { next.fields.timestamp = value; })} />
        <label>
          <span>Timestamp format</span>
          <select
            name="generic-timestamp-format"
            value={props.draft.fields.timestampFormat}
            onChange={(event) =>
              props.mutate((next) => {
                next.fields.timestampFormat = event.target.value as GenericJsonMappingDraft["fields"]["timestampFormat"];
              })
            }
          >
            <option value="rfc3339">RFC 3339 with timezone</option>
            <option value="unix-seconds">Unix seconds</option>
            <option value="unix-milliseconds">Unix milliseconds</option>
            <option value="unix-nanoseconds">Unix nanoseconds</option>
          </select>
        </label>
        <FieldPointerSelect id="generic-operation" label="Operation value" value={props.draft.fields.operation} fields={props.fields} onChange={(value) => props.mutate((next) => { next.fields.operation = value; })} />
        <FieldPointerSelect id="generic-status" label="Outcome or status value" value={props.draft.fields.status} fields={props.fields} onChange={(value) => props.mutate((next) => { next.fields.status = value; })} />
        <FieldPointerSelect id="generic-state-change" label="State-change value" value={props.draft.fields.stateChange} fields={props.fields} onChange={(value) => props.mutate((next) => { next.fields.stateChange = value; })} />
      </div>
      <div className="mapping-source-pair">
        <SourceMapping
          title="Actor ID"
          mode={props.draft.fields.actorIdMode}
          value={props.draft.fields.actorId}
          fields={props.fields}
          constantKind="text"
          onMode={(mode) => props.mutate((next) => { next.fields.actorIdMode = mode; next.fields.actorId = ""; })}
          onValue={(value) => props.mutate((next) => { next.fields.actorId = value; })}
        />
        <SourceMapping
          title="Actor type"
          mode={props.draft.fields.actorTypeMode}
          value={props.draft.fields.actorType}
          fields={props.fields}
          constantKind="actor-type"
          onMode={(mode) => props.mutate((next) => { next.fields.actorTypeMode = mode; next.fields.actorType = ""; })}
          onValue={(value) => props.mutate((next) => { next.fields.actorType = value; })}
        />
      </div>
    </fieldset>
  );
}

function SourceMapping(props: {
  title: string;
  mode: "path" | "constant";
  value: string;
  fields: string[];
  constantKind: "text" | "actor-type";
  onMode: (mode: "path" | "constant") => void;
  onValue: (value: string) => void;
}) {
  const slug = props.title.toLowerCase().replace(/\s+/g, "-");
  return (
    <div>
      <label>
        <span>{props.title} source</span>
        <select
          name={`generic-${slug}-mode`}
          value={props.mode}
          onChange={(event) => props.onMode(event.target.value as "path" | "constant")}
        >
          <option value="path">Read from each record</option>
          <option value="constant">Use one confirmed value</option>
        </select>
      </label>
      {props.mode === "path" ? (
        <FieldPointerSelect
          id={`generic-${slug}`}
          label={`${props.title} field`}
          value={props.value}
          fields={props.fields}
          onChange={props.onValue}
        />
      ) : props.constantKind === "actor-type" ? (
        <label>
          <span>Confirmed actor type</span>
          <select
            name="generic-actor-type-constant"
            value={props.value}
            onChange={(event) => props.onValue(event.target.value)}
          >
            <option value="">Choose actor type</option>
            <option value="agent">Agent</option>
            <option value="workflow">Workflow</option>
            <option value="tool">Tool</option>
            <option value="human">Human</option>
          </select>
        </label>
      ) : (
        <TextField
          name="generic-actor-id-constant"
          label="Confirmed actor ID"
          value={props.value}
          onChange={props.onValue}
        />
      )}
    </div>
  );
}

function SemanticMappingFields(props: {
  draft: GenericJsonMappingDraft;
  values: {
    operations: SemanticValue[];
    statuses: SemanticValue[];
    stateChanges: SemanticValue[];
    actorTypes: SemanticValue[];
  };
  mutate: Mutate;
}) {
  return (
    <section className="mapping-section semantic-section" aria-labelledby="semantic-title">
      <div className="mapping-section-heading">
        <div>
          <p className="section-number">Step 03B</p>
          <h3 id="semantic-title">Translate observed values</h3>
        </div>
        <p>Blank meanings remain material and unparsed.</p>
      </div>
      <SemanticMappingTable
        idPrefix="operation-map"
        title="Operations"
        values={props.values.operations}
        selected={props.draft.values.operations}
        options={ALL_OPERATIONS.map((value) => ({ value, label: value }))}
        onChange={(key, value) =>
          props.mutate((next) => {
            next.values.operations[key] = value as CanonicalOperation | "";
          })
        }
      />
      <SemanticMappingTable
        idPrefix="status-map"
        title="Event outcomes"
        values={props.values.statuses}
        selected={props.draft.values.statuses}
        options={["started", "succeeded", "failed", "cancelled", "unknown"].map((value) => ({ value, label: value }))}
        onChange={(key, value) =>
          props.mutate((next) => {
            next.values.statuses[key] = value as GenericJsonMappingDraft["values"]["statuses"][string];
          })
        }
      />
      <SemanticMappingTable
        idPrefix="state-map"
        title="State changes"
        values={props.values.stateChanges}
        selected={Object.fromEntries(
          Object.entries(props.draft.values.stateChanges).map(([key, value]) => [
            key,
            value === "" ? "" : String(value),
          ]),
        )}
        options={[
          { value: "false", label: "No state change" },
          { value: "true", label: "Changes state" },
        ]}
        onChange={(key, value) =>
          props.mutate((next) => {
            next.values.stateChanges[key] =
              value === "" ? "" : value === "true";
          })
        }
      />
      {props.draft.fields.actorTypeMode === "path" ? (
        <SemanticMappingTable
          idPrefix="actor-map"
          title="Actor types"
          values={props.values.actorTypes}
          selected={props.draft.values.actorTypes}
          options={["agent", "workflow", "tool", "human"].map((value) => ({ value, label: value }))}
          onChange={(key, value) =>
            props.mutate((next) => {
              next.values.actorTypes[key] = value as GenericJsonMappingDraft["values"]["actorTypes"][string];
            })
          }
        />
      ) : null}
    </section>
  );
}

function AdvancedMappingFields(props: {
  draft: GenericJsonMappingDraft;
  fields: string[];
  boundaryValues: SemanticValue[];
  mutate: Mutate;
}) {
  const setField = (
    field: keyof GenericJsonMappingDraft["fields"],
    value: string,
  ) => {
    props.mutate((next) => {
      (next.fields[field] as string) = value;
    });
  };
  const pointerFields: Array<{
    key: keyof GenericJsonMappingDraft["fields"];
    id: string;
    label: string;
  }> = [
    { key: "parentEventId", id: "generic-parent", label: "Parent event ID" },
    { key: "toolName", id: "generic-tool", label: "Tool name" },
    { key: "sourceSystem", id: "generic-source-system", label: "Source system" },
    { key: "destinationSystem", id: "generic-destination-system", label: "Destination system" },
    { key: "destinationBoundary", id: "generic-boundary", label: "Destination boundary" },
    { key: "resourceType", id: "generic-resource", label: "Resource type" },
    { key: "dataCategories", id: "generic-categories", label: "Data categories" },
    { key: "approvalRef", id: "generic-approval", label: "Approval reference" },
    { key: "actionKey", id: "generic-action-key", label: "Action key" },
    { key: "attempt", id: "generic-attempt", label: "Attempt number" },
  ];

  return (
    <details className="mapping-section advanced-mapping">
      <summary>Map additional policy evidence</summary>
      <p>
        Optional fields enable system, egress, category, volume, and approval
        checks. Missing facts remain unknown.
      </p>
      <div className="mapping-field-grid">
        {pointerFields.map((field) => (
          <FieldPointerSelect
            key={field.key}
            id={field.id}
            label={field.label}
            optional
            value={props.draft.fields[field.key] as string}
            fields={props.fields}
            onChange={(value) => setField(field.key, value)}
          />
        ))}
        <FieldPointerSelect
          id="generic-quantity"
          label="Quantity value"
          optional
          value={props.draft.fields.quantityValue}
          fields={props.fields}
          onChange={(value) =>
            props.mutate((next) => {
              next.fields.quantityValue = value;
              if (value === "") next.fields.quantityUnit = "";
            })
          }
        />
        <label>
          <span>Quantity unit <em>Optional</em></span>
          <select
            name="generic-quantity-unit"
            value={props.draft.fields.quantityUnit}
            disabled={props.draft.fields.quantityValue === ""}
            onChange={(event) =>
              props.mutate((next) => {
                next.fields.quantityUnit = event.target.value as GenericJsonMappingDraft["fields"]["quantityUnit"];
              })
            }
          >
            <option value="">Choose unit</option>
            <option value="records">Records</option>
            <option value="messages">Messages</option>
            <option value="bytes">Bytes</option>
            <option value="files">Files</option>
          </select>
        </label>
      </div>
      {props.draft.fields.destinationBoundary !== "" ? (
        <SemanticMappingTable
          idPrefix="boundary-map"
          title="Destination boundaries"
          values={props.boundaryValues}
          selected={props.draft.values.boundaries}
          options={["local", "internal", "external", "unknown"].map((value) => ({ value, label: value }))}
          onChange={(key, value) =>
            props.mutate((next) => {
              next.values.boundaries[key] = value as GenericJsonMappingDraft["values"]["boundaries"][string];
            })
          }
        />
      ) : null}
    </details>
  );
}

function MappingPreview(props: { validation: GenericMappingValidation }) {
  const className = props.validation.ok
    ? props.validation.preview.unparsed === 0
      ? "mapping-preview mapping-preview-complete"
      : "mapping-preview mapping-preview-partial"
    : "mapping-preview mapping-preview-incomplete";
  return (
    <section
      className={className}
      aria-labelledby="mapping-preview-title"
      aria-live="polite"
    >
      <div>
        <p className="section-number">Deterministic preview</p>
        <h3 id="mapping-preview-title">
          {props.validation.ok
            ? props.validation.preview.unparsed === 0
              ? "Every selected record maps."
              : "Some selected records remain unparsed."
            : "Complete the mapping to preview accounting."}
        </h3>
      </div>
      {props.validation.ok ? (
        <>
          <dl>
            <div><dt>Selected</dt><dd>{props.validation.preview.rawRecords}</dd></div>
            <div><dt>Mapped</dt><dd>{props.validation.preview.mapped}</dd></div>
            <div><dt>Unparsed</dt><dd>{props.validation.preview.unparsed}</dd></div>
          </dl>
          {props.validation.preview.unparsed > 0 ? (
            <div className="mapping-preview-reasons">
              <p>
                Material unparsed records force an incomplete assessment while
                remaining inspectable.
              </p>
              <ul>
                {props.validation.preview.reasons.map((reason, index) => (
                  <li key={`${reason}-${index}`}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mapping-preview-note">
              This proves coverage for the selected array, not that the source
              log captured every real-world action.
            </p>
          )}
        </>
      ) : (
        <ul className="mapping-issues">
          {props.validation.issues.slice(0, 8).map((issue, index) => (
            <li key={`${issue.path}-${index}`}>
              <code>{issue.path}</code>: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type SemanticValue = { key: string; label: string; count: number };

function SemanticMappingTable(props: {
  idPrefix: string;
  title: string;
  values: SemanticValue[];
  selected: Record<string, string>;
  options: Array<{ value: string; label: string }>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <fieldset className="semantic-map">
      <legend>{props.title}</legend>
      {props.values.length === 0 ? (
        <p className="semantic-map-empty">
          Choose a source field to reveal its observed values.
        </p>
      ) : (
        <div className="semantic-map-rows">
          {props.values.map((value, index) => {
            const id = `${props.idPrefix}-${index}`;
            return (
              <div className="semantic-map-row" key={value.key}>
                <div>
                  <code>{value.label}</code>
                  <span>{value.count} {formatCountLabel(value.count, "record")}</span>
                </div>
                <label htmlFor={id}>
                  <span>Canonical meaning</span>
                  <select
                    id={id}
                    name={id}
                    value={props.selected[value.key] ?? ""}
                    onChange={(event) => props.onChange(value.key, event.target.value)}
                  >
                    <option value="">Leave unparsed</option>
                    {props.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function FieldPointerSelect(props: {
  id: string;
  label: string;
  optional?: boolean;
  value: string;
  fields: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={props.id}>
      <span>{props.label} {props.optional ? <em>Optional</em> : null}</span>
      <select
        id={props.id}
        name={props.id}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        <option value="">
          {props.optional ? "Not supplied" : "Choose a field"}
        </option>
        {props.fields.map((field) => (
          <option key={field} value={field}>{field}</option>
        ))}
      </select>
    </label>
  );
}

function TextField(props: {
  name: string;
  label: string;
  optional?: boolean;
  value: string;
  placeholder?: string;
  describedBy?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{props.label} {props.optional ? <em>Optional</em> : null}</span>
      <input
        name={props.name}
        value={props.value}
        placeholder={props.placeholder}
        aria-describedby={props.describedBy}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}
