import { useState } from "react";
import { Field, NumberField } from "./controls";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { endTime, type Project } from "./model";
export type DetectionOptions = {
  strategy: string;
  segment?: [number, number];
  selectedIds: string[];
  settings: Record<string, unknown>;
};
const defaults: Record<string, unknown> = {
  sensitivity: 0.5,
  min_confidence: 0.55,
  minimum_spacing: 0.3,
  max_overlap: 3,
  sample_fps: 12,
  density: "high",
  style: "cartoon",
  avoid_repetition: true,
  protect_original: true,
  visual_enabled: false,
  allowed_categories: [],
};
export function Detection({
  project,
  selected,
  close,
  run,
}: {
  project: Project;
  selected: string | null;
  close: () => void;
  run: (o: DetectionOptions) => void;
}) {
  const [params, setParams] = useState({
      ...defaults,
      ...project.analysis_settings,
    }),
    [strategy, setStrategy] = useState("update_auto"),
    [range, setRange] = useState(false),
    [from, setFrom] = useState(0),
    [to, setTo] = useState(endTime(project));
  const set = (k: string, v: unknown) => setParams((s) => ({ ...s, [k]: v }));
  return (
    <Dialog title="Automatic annotation" close={close}>
      <div className="dialog-body detection">
        <p className="hint">
          Analyze motion offline and match compatible sounds from the selected
          SFX library.
        </p>
        <Field label="Existing annotations">
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
          >
            <option value="update_auto">
              Update unreviewed automatic cues
            </option>
            <option value="merge">Keep cues and add new matches</option>
            <option value="keep">Detect events only</option>
            <option value="replace_selected" disabled={!selected}>
              Replace selected cue
            </option>
            <option value="full_regenerate">
              Regenerate all editable cues
            </option>
          </select>
        </Field>
        <div className="field-grid">
          {[
            ["Sensitivity", "sensitivity", 0, 1, 0.01],
            ["Minimum confidence", "min_confidence", 0, 1, 0.01],
            ["Min. spacing (s)", "minimum_spacing", 0, 30, 0.1],
            ["Overlap limit", "max_overlap", 1, 10, 1],
            ["Sample rate (fps)", "sample_fps", 1, 60, 1],
          ].map(([label, key, min, max, step]) => (
            <NumberField
              key={String(key)}
              label={String(label)}
              value={Number(params[key])}
              min={Number(min)}
              max={Number(max)}
              step={Number(step)}
              change={(v) => set(String(key), v)}
            />
          ))}
          <Field label="Density">
            <select
              value={String(params.density)}
              onChange={(e) => set("density", e.target.value)}
            >
              {["low", "medium", "high"].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Sound style">
          <input
            value={String(params.style)}
            onChange={(e) => set("style", e.target.value)}
          />
        </Field>
        <Field label="Allowed categories (comma separated)">
          <input
            defaultValue={(params.allowed_categories as string[]).join(", ")}
            onBlur={(e) =>
              set(
                "allowed_categories",
                e.target.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              )
            }
          />
        </Field>
        {[
          ["Avoid repeated sounds", "avoid_repetition"],
          ["Protect original audio", "protect_original"],
          ["Generate visual accents", "visual_enabled"],
        ].map(([name, key]) => (
          <label className="toggle-row" key={key}>
            {name}
            <input
              type="checkbox"
              checked={!!params[key]}
              onChange={(e) => set(key, e.target.checked)}
            />
          </label>
        ))}
        <label className="toggle-row">
          Analyze a timeline range
          <input
            type="checkbox"
            checked={range}
            onChange={(e) => setRange(e.target.checked)}
          />
        </label>
        {range && (
          <div className="field-grid">
            <NumberField
              label="In (s)"
              value={from}
              max={to}
              change={setFrom}
            />
            <NumberField
              label="Out (s)"
              value={to}
              min={from}
              max={endTime(project)}
              change={setTo}
            />
          </div>
        )}
        {strategy === "full_regenerate" && (
          <p className="warning">
            This replaces editable cues in the analysis range. Undo restores the
            previous timeline.
          </p>
        )}
        <div className="dialog-actions">
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="default"
            disabled={range && from >= to}
            onClick={() => {
              const settings = { ...params };
              delete settings.pose_model;
              run({
                strategy,
                settings,
                selectedIds: selected ? [selected] : [],
                segment: range ? [from, to] : undefined,
              });
              close();
            }}
          >
            Run analysis
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
