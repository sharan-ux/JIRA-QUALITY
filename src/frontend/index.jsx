import React, { useEffect, useState } from "react";
import ForgeReconciler, {
  Text,
  Strong,
  Box,
  Inline,
  Stack,
  Heading,
  Lozenge,
  Spinner,
  DynamicTable,
} from "@forge/react";
import { invoke } from "@forge/bridge";

/* ---- style tokens ---- */
const panel = {
  padding: "space.300",
  backgroundColor: "elevation.surface.raised",
  borderRadius: "border.radius.300",
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border",
};
const tile = {
  padding: "space.250",
  backgroundColor: "elevation.surface.sunken",
  borderRadius: "border.radius.200",
  minWidth: "150px",
};

/* stage -> color group (matches legend: definition/build/verify/ship & review) */
const STAGE_APPEARANCE = {
  def: "new",         // purple — definition
  dev: "inprogress",  // blue — build
  qa: "moved",        // amber — verify
  deploy: "success",  // teal/green — ship & review
  knowledge: "success",
  bareview: "success",
};
const STATUS_APPEARANCE = { "To Do": "default", "In Progress": "inprogress", Done: "success" };

const badge = (n, appearance) =>
  n ? <Lozenge appearance={appearance}>{String(n)}</Lozenge> : <Text>—</Text>;

const Tile = ({ label, value, appearance }) => (
  <Box xcss={tile}>
    <Text size="xlarge"><Strong>{value}</Strong></Text>
    <Lozenge appearance={appearance}>{label}</Lozenge>
  </Box>
);

const App = () => {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    invoke("getDashboard").then(setD).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <Text>Couldn't load: {err}</Text>;
  if (!d) return <Spinner label="Loading launch status…" />;

  const statusHead = {
    cells: [
      { key: "epic", content: "Epic", isSortable: true },
      ...d.statusCols.map((c) => ({ key: c, content: c })),
      { key: "total", content: "Total" },
    ],
  };
  const statusRows = d.epics.map((e) => ({
    key: e.key,
    cells: [
      { key: "epic", content: <Text><Strong>{e.summary}</Strong></Text> },
      ...d.statusCols.map((c) => ({ key: c, content: badge(e.cat[c], STATUS_APPEARANCE[c]) })),
      { key: "total", content: <Text><Strong>{e.totalAll || "—"}</Strong></Text> },
    ],
  }));

  const phaseHead = {
    cells: [
      { key: "epic", content: "Epic", isSortable: true },
      ...d.stages.map((s) => ({ key: s.key, content: s.name })),
      { key: "open", content: "Open total" },
    ],
  };
  const phaseRows = d.epics.map((e) => ({
    key: e.key,
    cells: [
      { key: "epic", content: <Text><Strong>{e.summary}</Strong></Text> },
      ...d.stages.map((s) => ({ key: s.key, content: badge(e.phase[s.key], STAGE_APPEARANCE[s.key]) })),
      { key: "open", content: <Text><Strong>{e.totalOpen || "—"}</Strong></Text> },
    ],
  }));

  return (
    <Stack space="space.400">
      {/* Header */}
      <Stack space="space.050">
        <Heading as="h2">Launch status — Justin</Heading>
        <Text size="small">Phases as labels · BA reviews auto-created at +90 days</Text>
      </Stack>

      {/* Tiles */}
      <Inline space="space.200" shouldWrap>
        <Tile label="Total tasks" value={d.tiles.total} appearance="default" />
        <Tile label="Done" value={d.tiles.done} appearance="success" />
        <Tile label="Due this week" value={d.tiles.dueThisWeek} appearance="moved" />
        <Tile label="BA reviews pending" value={d.tiles.baPending} appearance="inprogress" />
      </Inline>

      {/* Epic progress by stage */}
      <Box xcss={panel}>
        <Stack space="space.150">
          <Heading as="h3">Epic progress by stage</Heading>
          <DynamicTable head={statusHead} rows={statusRows} rowsPerPage={10} emptyView="No tracked epics." />
        </Stack>
      </Box>

      {/* Epic progress by phase */}
      <Box xcss={panel}>
        <Stack space="space.150">
          <Heading as="h3">Epic progress by phase</Heading>
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Text size="small">Open tasks only ·</Text>
            <Lozenge appearance="new">Definition</Lozenge>
            <Lozenge appearance="inprogress">Build</Lozenge>
            <Lozenge appearance="moved">Verify</Lozenge>
            <Lozenge appearance="success">Ship &amp; review</Lozenge>
          </Inline>
          <DynamicTable head={phaseHead} rows={phaseRows} rowsPerPage={10} emptyView="No tracked epics." />
        </Stack>
      </Box>

      {/* Bottom: two panels side by side */}
      <Inline space="space.300" shouldWrap alignBlock="stretch">
        <Box xcss={{ ...panel, minWidth: "320px" }}>
          <Stack space="space.150">
            <Heading as="h3">Due this week</Heading>
            {d.dueThisWeek.length === 0 ? (
              <Text size="small">Nothing due this week.</Text>
            ) : (
              d.dueThisWeek.map((t) => (
                <Inline key={t.key} space="space.100" alignBlock="center" spread="space-between">
                  <Text><Strong>{t.key}</Strong> {t.summary}</Text>
                  <Lozenge appearance={t.overdue ? "removed" : "default"}>{t.duedate}</Lozenge>
                </Inline>
              ))
            )}
          </Stack>
        </Box>

        <Box xcss={{ ...panel, minWidth: "320px" }}>
          <Stack space="space.150">
            <Heading as="h3">Upcoming BA reviews</Heading>
            <Text size="small">Auto-created 90 days after an epic ships</Text>
            {d.baReviews.length === 0 ? (
              <Text size="small">None yet.</Text>
            ) : (
              d.baReviews.map((t) => (
                <Inline key={t.key} space="space.100" alignBlock="center" spread="space-between">
                  <Text><Strong>{t.key}</Strong> {t.summary}</Text>
                  {t.duedate ? <Lozenge appearance="inprogress">{t.duedate}</Lozenge> : null}
                </Inline>
              ))
            )}
          </Stack>
        </Box>
      </Inline>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
