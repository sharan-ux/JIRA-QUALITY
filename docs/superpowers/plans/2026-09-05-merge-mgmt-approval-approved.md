# Merge "Mgmt Approval" + "Approved" → "Management Approval" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Feature QC framework's two late-stage phases (Mgmt Approval + Approved) into one "Management Approval" phase (16→15 phases) across the dashboard, the provisioning trigger, and the qc-checklist skill docs, then migrate already-provisioned feature epics.

**Architecture:** Two array edits (framework.js for the dashboard render, provision.js for new-epic provisioning) drive the framework change; all downstream logic is label-based so no index math changes. A one-time in-page REST migration folds each existing epic's "Approved" story into its "Mgmt Approval" story and retires the Approved story.

**Tech Stack:** Forge (manifest triggers + resolvers, Node), Vite/React (static/compliance), Atlassian Jira REST v3 + Gebsun "Checklist for Jira" custom fields, claude-in-chrome for in-page REST.

**Spec:** `launch-dashboard/docs/superpowers/specs/2026-09-05-merge-mgmt-approval-approved-design.md`

## Global Constraints

- **NEVER auto-commit.** Every step labelled "Stage" means run `git add <files>` and hand off to the user for review + manual commit. Do **not** run `git commit`.
- **Build/deploy:** Node PATH `export PATH="/c/Users/Sharan/.config/herd/bin/nvm/v22.23.2:$PATH"`. Build: `cd static/compliance && npm run build`. Deploy: `cd launch-dashboard && forge deploy -e production --no-verify`.
- **Atlassian MCP is ungranted** — all Jira reads/writes go through claude-in-chrome in-page `fetch` from a **Jira board/work page** (`https://zilmoney.atlassian.net/jira/your-work`), NOT an issue view (CSP). Use `credentials:'include'`, header `X-Atlassian-Token: no-check`.
- **Gebsun fields:** `customfield_10051` = editable source (orderedList[header] + bulletList[items as `[state] text`]); `customfield_10097` = rendered (dashboard reads this via `CF.text`); `customfield_10094` = Gebsun-computed count (rejects direct writes — never PUT it). Write `10051`, let Gebsun re-render `10097`; if it doesn't, regenerate `10097` faithfully from `10051` preserving `inlineCard` nodes as their issue key.
- **Merged phase identity:** name `Management Approval`, label `phase-mgmt-approval` (retire `phase-approved`), owner `Management / Eng Lead`, one COO item.
- **Migration writes to production epics** — dry-run + user approval before any write; verify per epic.

---

### Task 1: Update the dashboard framework (framework.js)

**Files:**
- Modify: `static/compliance/src/framework.js` (FEATURE_PHASES Mgmt Approval + Approved entries; FEATURE_LABELS array)

**Interfaces:**
- Produces: `FEATURE_PHASES` and `FEATURE_LABELS` are both 15 entries, index-aligned; the merged phase is `{ name: 'Management Approval', owner: 'Management / Eng Lead', items: [8] }` at the old Mgmt Approval position with label `phase-mgmt-approval`.

- [ ] **Step 1: Replace the two phase entries with one.** Find this exact block:

```js
  { name: 'Mgmt Approval', owner: 'Management', items: [
    { txt: 'Business case and KPI targets reviewed against what was actually built', owner: 'PM' },
    { txt: 'A risk assessment is reviewed', owner: 'Eng Lead / PM' },
    { txt: 'Budget or resourcing impacts reviewed, if applicable', owner: 'Finance / PM' },
    { txt: 'A go/no-go decision documented with a named approver', owner: 'Management' },
    { txt: 'The rollout plan reviewed (phased, feature flag, or full launch)', owner: 'PM / Eng Lead' },
    COO,
  ]},
  { name: 'Approved', owner: 'Eng Lead', items: [
    { txt: 'Release notes are drafted', owner: 'PM' },
    { txt: 'A rollback plan is documented and reviewed by engineering', owner: 'Eng Lead' },
    { txt: 'A deployment runbook is prepared', owner: 'DevOps / Eng' },
    { txt: 'A change-management ticket filed if required by policy', owner: 'Eng Lead' },
    { txt: 'Final legal/compliance review scheduled and linked to Compliance Sign-off', owner: 'PM / Legal' },
    COO,
  ]},
```

Replace with:

```js
  { name: 'Management Approval', owner: 'Management / Eng Lead', items: [
    { txt: 'Business case and KPI targets reviewed against what was actually built', owner: 'PM' },
    { txt: 'A risk assessment is reviewed', owner: 'Eng Lead / PM' },
    { txt: 'Budget or resourcing impacts reviewed, if applicable', owner: 'Finance / PM' },
    { txt: 'A go/no-go decision documented with a named approver', owner: 'Management' },
    { txt: 'Release notes are drafted', owner: 'PM' },
    { txt: 'Release approach confirmed — merge to the production branch triggers the CI/CD pipeline (no manual runbook/change ticket); rollback = revert the merge commit + re-run the pipeline', owner: 'Eng Lead' },
    { txt: 'Final legal/compliance review scheduled and linked to Compliance Sign-off', owner: 'PM / Legal' },
    COO,
  ]},
```

- [ ] **Step 2: Update FEATURE_LABELS.** Find:

```js
const FEATURE_LABELS = ["phase-knowledge", "phase-ba", "phase-todo", "phase-uiux", "phase-development", "phase-qa-scheduled", "phase-in-qa", "phase-qa-passed", "phase-mgmt-approval", "phase-approved", "phase-compliance", "phase-deployment", "phase-sales-support", "phase-marketing", "phase-done", "phase-ba-review"];
```

Replace with (remove `"phase-approved"`):

```js
const FEATURE_LABELS = ["phase-knowledge", "phase-ba", "phase-todo", "phase-uiux", "phase-development", "phase-qa-scheduled", "phase-in-qa", "phase-qa-passed", "phase-mgmt-approval", "phase-compliance", "phase-deployment", "phase-sales-support", "phase-marketing", "phase-done", "phase-ba-review"];
```

- [ ] **Step 3: Sanity-check array alignment.** Confirm `FEATURE_PHASES` now has 15 entries and `FEATURE_LABELS` has 15 entries, and index 8 of each is Management Approval / `phase-mgmt-approval`. (Grep: `grep -n "phase-approved" static/compliance/src/framework.js` must return nothing.)

- [ ] **Step 4: Build to verify no syntax error.**

Run: `export PATH="/c/Users/Sharan/.config/herd/bin/nvm/v22.23.2:$PATH" && cd "/c/Project Codes/JIRA-DASHBOARD/launch-dashboard/static/compliance" && npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 5: Stage (no commit).**

Run: `git add static/compliance/src/framework.js` — then report; user commits.

---

### Task 2: Update the provisioning trigger (provision.js)

**Files:**
- Modify: `src/triggers/provision.js` (FEATURE_PHASES Mgmt Approval + Approved entries)

**Interfaces:**
- Produces: new feature epics provision one `phase-mgmt-approval` story named "Management Approval" with the 8-item checklist and no `phase-approved` story.

- [ ] **Step 1: Replace the two phase entries with one.** Find this exact block (item strings; the Mgmt Approval COO line was retained during the earlier COO cleanup):

```js
  { name: 'Mgmt Approval', label: 'phase-mgmt-approval', items: [
    'Business case and KPI targets reviewed against what was actually built',
    'A risk assessment is reviewed',
    'Budget or resourcing impacts reviewed, if applicable',
    'A go/no-go decision documented with a named approver',
    'The rollout plan reviewed (phased, feature flag, or full launch)',
    'COO (or delegate) sign-off recorded — by name and date',
  ]},
  { name: 'Approved', label: 'phase-approved', items: [
    'Release notes are drafted',
    'A rollback plan is documented and reviewed by engineering',
    'A deployment runbook is prepared',
    'A change-management ticket filed if required by policy',
    'Final legal/compliance review scheduled and linked to Compliance Sign-off',
    'COO (or delegate) sign-off recorded — by name and date',
  ]},
```

Replace with:

```js
  { name: 'Management Approval', label: 'phase-mgmt-approval', items: [
    'Business case and KPI targets reviewed against what was actually built',
    'A risk assessment is reviewed',
    'Budget or resourcing impacts reviewed, if applicable',
    'A go/no-go decision documented with a named approver',
    'Release notes are drafted',
    'Release approach confirmed — merge to the production branch triggers the CI/CD pipeline (no manual runbook/change ticket); rollback = revert the merge commit + re-run the pipeline',
    'Final legal/compliance review scheduled and linked to Compliance Sign-off',
    'COO (or delegate) sign-off recorded — by name and date',
  ]},
```

> If the exact strings differ (e.g. the COO line was also removed here), grep `grep -n "phase-approved\|Mgmt Approval\|The rollout plan" src/triggers/provision.js` first and adapt the match to the real text — keep the 8-item result identical to above.

- [ ] **Step 2: Confirm removal.** `grep -n "phase-approved" src/triggers/provision.js` returns nothing.

- [ ] **Step 3: Stage (no commit).**

Run: `git add src/triggers/provision.js` — then report; user commits.

---

### Task 3: Deploy and verify new-epic provisioning

**Files:** none (build + deploy + live check)

**Interfaces:**
- Consumes: Tasks 1 & 2 edits.
- Produces: production v(next) deployed; confirmation that a fresh feature epic provisions the 15-phase shape.

- [ ] **Step 1: Build.**

Run: `export PATH="/c/Users/Sharan/.config/herd/bin/nvm/v22.23.2:$PATH" && cd "/c/Project Codes/JIRA-DASHBOARD/launch-dashboard/static/compliance" && npm run build`
Expected: `✓ built`.

- [ ] **Step 2: Deploy.**

Run: `export PATH="/c/Users/Sharan/.config/herd/bin/nvm/v22.23.2:$PATH" && cd "/c/Project Codes/JIRA-DASHBOARD/launch-dashboard" && forge deploy -e production --no-verify`
Expected: `✔ Deployed`.

- [ ] **Step 3: Create a throwaway test feature epic** (in-page on a Jira work page). This is a WRITE — it is a disposable test artifact; delete in Task 7.

```js
const base='https://zilmoney.atlassian.net';
const post=(u,p)=>fetch(base+u,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-Atlassian-Token':'no-check'},body:JSON.stringify(p)}).then(async r=>({ok:r.ok,status:r.status,body:await r.json().catch(()=>null)}));
const doc={type:'doc',version:1,content:[{type:'paragraph',content:[{type:'text',text:'TEST — verifying 15-phase merge. Delete after test.'}]}]};
const r=await post('/rest/api/3/issue',{fields:{project:{key:'OCW'},issuetype:{name:'Epic'},summary:'TEST — Merge phase verification (delete after test)',labels:['EPIC','feature','qc-test'],description:doc}});
window.__testEpic=r.body?.key; r.body?.key;
```

- [ ] **Step 4: Wait ~15s, then verify the test epic provisioned 15 phases and Management Approval is correct, no phase-approved.**

```js
const base='https://zilmoney.atlassian.net';
const j=(u)=>fetch(base+u,{credentials:'include',headers:{Accept:'application/json'}}).then(r=>r.json());
const enc=encodeURIComponent;
const k=window.__testEpic;
async function all(jql,fields){let out=[],t=null;do{const u=base+'/rest/api/3/search/jql?jql='+enc(jql)+'&fields='+enc(fields)+'&maxResults=100'+(t?'&nextPageToken='+enc(t):'');const r=await(await fetch(u,{credentials:'include',headers:{Accept:'application/json'}})).json();out=out.concat(r.issues||[]);t=r.nextPageToken;}while(t);return out;}
const kids=await all('parent='+k+' AND labels=qc-phase','labels');
const labels=kids.map(i=>(i.fields.labels||[]).find(l=>l.startsWith('phase-'))).sort();
function lines(adf){const L=[];for(const b of (adf?.content||[])){let c='';for(const n of (b.content||[])){if(n.type==='text')c+=n.text;else if(n.type==='hardBreak'){L.push(c);c='';}}L.push(c);}return L.map(x=>x.replace(/​/g,'').trim()).filter(Boolean);}
const mgmt=kids.find(i=>(i.fields.labels||[]).includes('phase-mgmt-approval'));
let mgmtItems=[];
if(mgmt){const f=await j('/rest/api/3/issue/'+mgmt.key+'?fields=summary,customfield_10097');mgmtItems=lines(f.fields.customfield_10097).filter(l=>/^[*+-]\s*\[/.test(l));}
({phaseCount:kids.length, hasApproved:labels.includes('phase-approved'), mgmtName:mgmt&&(await j('/rest/api/3/issue/'+mgmt.key+'?fields=summary')).fields.summary, mgmtItemCount:mgmtItems.length, mgmtItems});
```

Expected: `phaseCount:15`, `hasApproved:false`, `mgmtName` contains "Management Approval", `mgmtItemCount:8`, and the 8 item texts match the merged list.

- [ ] **Step 5: Verify QA-Rework insertion still works** (regression) — inspected in the dashboard once DNS resolves, or trust the label-based logic (spec §4.1). Note this as verified-by-design if the dashboard UI is unreachable.

- [ ] **Step 6: Stage nothing (deploy only); report results.**

---

### Task 4: Update the qc-checklist skill docs

**Files:**
- Modify: `C:/Users/Sharan/.claude/skills/qc-checklist/SKILL.md`

**Interfaces:**
- Produces: skill Feature framework shows 15 phases with a single "9. Management Approval" (8 items) and no `phase-approved` label.

- [ ] **Step 1: Change the Feature framework heading.** Replace `## Framework — Feature (16 phases)` with `## Framework — Feature (15 phases)`. Also fix any other "Feature (16 phases)" / "16-phase" references for Feature (leave the Bug framework counts alone).

- [ ] **Step 2: Merge sections 9 and 10.** Replace the two blocks:

```
**9. Mgmt Approval** — owner: Management
- Business case + KPI targets reviewed vs what was built (PM)
- Risk assessment reviewed (Eng Lead/PM)
- Budget/resourcing impacts reviewed if applicable (Finance/PM)
- Documented go/no-go decision w/ named approver (Management)
- Rollout plan reviewed (PM/Eng Lead)
- COO sign-off recorded — name + date (COO)

**10. Approved** — owner: Eng Lead
- Release notes drafted (PM)
- Rollback plan documented + reviewed (Eng Lead)
- Deployment runbook prepared (DevOps/Eng)
- Change-management ticket filed if required (Eng Lead)
- Final legal/compliance review scheduled, linked to Compliance Sign-off (PM/Legal)
- COO sign-off recorded — name + date (COO)
```

with a single block:

```
**9. Management Approval** — owner: Management / Eng Lead
- Business case + KPI targets reviewed vs what was built (PM)
- Risk assessment reviewed (Eng Lead/PM)
- Budget/resourcing impacts reviewed if applicable (Finance/PM)
- Documented go/no-go decision w/ named approver (Management)
- Release notes drafted (PM)
- Release approach confirmed — merge to production branch triggers CI/CD pipeline (no manual runbook/change ticket); rollback = revert the merge commit + re-run pipeline (Eng Lead)
- Final legal/compliance review scheduled, linked to Compliance Sign-off (PM/Legal)
- COO sign-off recorded — name + date (COO)
```

- [ ] **Step 3: Renumber the following Feature sections** 11→10 (Compliance Sign-off), 12→11 (Deployment), 13→12 (Sales & Support Training), 14→13 (Marketing Training), 15→14 (Done), 16→15 (BA Review). Update only the leading numbers; leave item text intact.

- [ ] **Step 4: Update the phase-labels line.** In "## Phase labels (story → phase)", remove `phase-approved` from the Feature list so it reads: `... phase-qa-passed phase-mgmt-approval phase-compliance phase-deployment phase-sales-support phase-marketing phase-done phase-ba-review` (Feature).

- [ ] **Step 5: Grep check.** `grep -n "phase-approved\|10. Approved\|Feature (16" ~/.claude/skills/qc-checklist/SKILL.md` returns nothing.

- [ ] **Step 6: No git needed** (skill lives outside the repo). Report done.

---

### Task 5: Migration dry-run (read-only report)

**Files:** none (in-page REST, reads only)

**Interfaces:**
- Produces: `window.__mig` = per-epic plan: `{epic, mgmtStory, approvedStory, mergedStates[8], notesToCarry[], notesToDrop[]}`; a summary the user approves before Task 6.

- [ ] **Step 1: Run the dry-run** on a Jira work page. Enumerates feature epics with BOTH stories, parses both checklists, computes merged states + note re-keying. No writes.

```js
const base='https://zilmoney.atlassian.net';
const j=(u)=>fetch(base+u,{credentials:'include',headers:{Accept:'application/json'}}).then(r=>r.json());
const enc=encodeURIComponent;
async function all(jql,fields){let o=[],t=null;do{const u=base+'/rest/api/3/search/jql?jql='+enc(jql)+'&fields='+enc(fields)+'&maxResults=100'+(t?'&nextPageToken='+enc(t):'');const r=await(await fetch(u,{credentials:'include',headers:{Accept:'application/json'}})).json();o=o.concat(r.issues||[]);t=r.nextPageToken;}while(t);return o;}
function items(adf){const L=[];for(const b of (adf?.content||[])){let c='';for(const n of (b.content||[])){if(n.type==='text')c+=n.text;else if(n.type==='hardBreak'){L.push(c);c='';}}L.push(c);}
  return L.map(x=>x.replace(/​/g,'').trim()).filter(l=>/^[*+-]\s*\[/.test(l)).map(l=>{const m=l.match(/^[*+-]\s*\[([^\]]*)\]\s*(.*)$/);const st=(m[1]||'').trim().toLowerCase();const state=(st==='done'||st==='complete'||st==='x')?'done':(st==='skipped'||st==='skip'||st==='na'||st==='n/a'||st==='-'||st==='~')?'skipped':'open';return {state,text:m[2]};});}
const find=(arr,re)=>arr.find(i=>re.test(i.text))||{state:'open'};
const epics=await all('issuetype = Epic AND labels = feature ORDER BY key ASC','summary');
const plan=[];
for(const e of epics){
  const kids=await all('parent="'+e.key+'" AND labels=qc-phase AND (labels="phase-mgmt-approval" OR labels="phase-approved")','labels,customfield_10097');
  const mgmt=kids.find(k=>(k.fields.labels||[]).includes('phase-mgmt-approval'));
  const appr=kids.find(k=>(k.fields.labels||[]).includes('phase-approved'));
  if(!mgmt||!appr) continue; // only epics with BOTH need migration
  const M=items(mgmt.fields.customfield_10097), A=items(appr.fields.customfield_10097);
  const mBiz=find(M,/business case/i), mRisk=find(M,/risk assessment/i), mBud=find(M,/budget/i), mGo=find(M,/go\/no-?go/i), mRoll=find(M,/rollout plan/i), mCOO=find(M,/coo/i);
  const aNotes=find(A,/release notes/i), aRb=find(A,/rollback/i), aLegal=find(A,/legal\/compliance|compliance sign-off/i), aCOO=find(A,/coo/i);
  const both=(x,y)=>x.state==='done'&&y.state==='done'?'done':(x.state==='skipped'&&y.state==='skipped'?'skipped':'open');
  const either=(x,y)=>x.state==='done'||y.state==='done'?'done':(x.state==='skipped'&&y.state==='skipped'?'skipped':'open');
  const merged=[mBiz.state,mRisk.state,mBud.state,mGo.state,aNotes.state,both(mRoll,aRb),aLegal.state,either(mCOO,aCOO)];
  plan.push({epic:e.key, mgmt:mgmt.key, approved:appr.key, mCount:M.length, aCount:A.length, mergedStates:merged});
}
window.__mig=plan;
({epicsWithBothStories:plan.length, sample:plan.slice(0,5)});
```

- [ ] **Step 2: Read epic-meta notes to carry** (for the same epics), so nothing is lost:

```js
const base='https://zilmoney.atlassian.net';
const j=(u)=>fetch(base+u,{credentials:'include',headers:{Accept:'application/json'}}).then(r=>r.json());
const NEWIDX={mgmt:{0:0,1:1,2:2,3:3,4:5,5:7}, appr:{0:4,1:5,4:6,5:7}}; // dropped: appr 2,3
for(const p of window.__mig){
  const pr=await j('/rest/api/3/issue/'+p.epic+'/properties/qc-compliance').catch(()=>({}));
  const meta=(pr&&pr.value)||{};
  const carry=[], drop=[];
  for(const [k,v] of Object.entries(meta)){
    if(!v||!v.note) continue;
    const m=k.match(/^(.+):(\d+)$/); if(!m) continue;
    const [_,sk,idxS]=m; const idx=+idxS;
    if(sk===p.mgmt && NEWIDX.mgmt[idx]!=null) carry.push({from:k, to:p.mgmt+':'+NEWIDX.mgmt[idx]});
    else if(sk===p.approved && NEWIDX.appr[idx]!=null) carry.push({from:k, to:p.mgmt+':'+NEWIDX.appr[idx]});
    else if(sk===p.approved && (idx===2||idx===3)) drop.push(k);
  }
  p.notesCarry=carry; p.notesDrop=drop;
}
({withNotes:window.__mig.filter(p=>p.notesCarry.length||p.notesDrop.length).map(p=>({epic:p.epic,carry:p.notesCarry,drop:p.notesDrop}))});
```

- [ ] **Step 3: Present the dry-run summary to the user** (epics affected, merged-state samples, notes carried/dropped) and **get approval** before Task 6. STOP here until approved.

---

### Task 6: Migration apply (per-epic, with verification)

**Files:** none (in-page REST writes to production epics — only after Task 5 approval)

**Interfaces:**
- Consumes: `window.__mig` (from Task 5).
- Produces: each affected epic's `phase-mgmt-approval` story renamed to "Management Approval" with the 8-item merged checklist + carried state + notes; each `phase-approved` story closed + de-`qc-phase`-labelled.

- [ ] **Step 1: Define the merged item texts + ADF builder + helpers** (run once to load into the page):

```js
window.MERGED_ITEMS=[
 'Business case and KPI targets reviewed against what was actually built',
 'A risk assessment is reviewed',
 'Budget or resourcing impacts reviewed, if applicable',
 'A go/no-go decision documented with a named approver',
 'Release notes are drafted',
 'Release approach confirmed — merge to the production branch triggers the CI/CD pipeline (no manual runbook/change ticket); rollback = revert the merge commit + re-run the pipeline',
 'Final legal/compliance review scheduled and linked to Compliance Sign-off',
 'COO (or delegate) sign-off recorded — by name and date',
];
window.buildSrc=(states)=>{ // 10051 form: orderedList[header] + bulletList[8 items "[state] text"]
  const li=t=>({type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:t}]}]});
  const mark=s=>s==='done'?'[done]':s==='skipped'?'[skipped]':'[open]';
  return {type:'doc',version:1,content:[
    {type:'orderedList',attrs:{order:1},content:[li('Management Approval')]},
    {type:'bulletList',content:window.MERGED_ITEMS.map((t,i)=>li(mark(states[i])+' '+t))},
  ]};
};
window.jget=(u)=>fetch('https://zilmoney.atlassian.net'+u,{credentials:'include',headers:{Accept:'application/json'}}).then(r=>r.json());
window.jput=(u,p)=>fetch('https://zilmoney.atlassian.net'+u,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json','X-Atlassian-Token':'no-check'},body:JSON.stringify(p)}).then(r=>({ok:r.ok,status:r.status}));
window.jpost=(u,p)=>fetch('https://zilmoney.atlassian.net'+u,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-Atlassian-Token':'no-check'},body:JSON.stringify(p)}).then(r=>({ok:r.ok,status:r.status}));
'helpers loaded';
```

- [ ] **Step 2: Apply per epic** (rename + rewrite checklist + re-key notes + retire Approved). Run over `window.__mig`:

```js
const res=[];
for(const p of window.__mig){
  try{
    // 2a. rewrite the mgmt story: rename + merged checklist
    const summ=(await window.jget('/rest/api/3/issue/'+p.epic+'?fields=summary')).fields.summary;
    await window.jput('/rest/api/3/issue/'+p.mgmt,{fields:{summary:'Management Approval — '+summ, customfield_10051:window.buildSrc(p.mergedStates)}});
    // 2b. re-key epic-meta notes
    const pr=await window.jget('/rest/api/3/issue/'+p.epic+'/properties/qc-compliance').catch(()=>({}));
    const meta=(pr&&pr.value)||{};
    let changed=false;
    for(const c of (p.notesCarry||[])){ if(meta[c.from]){ meta[c.to]={...(meta[c.to]||{}),...meta[c.from]}; if(c.from!==c.to) delete meta[c.from]; changed=true; } }
    for(const d of (p.notesDrop||[])){ if(meta[d]){ delete meta[d]; changed=true; } }
    if(changed) await window.jput('/rest/api/3/issue/'+p.epic+'/properties/qc-compliance',meta);
    // 2c. retire the Approved story: remove qc-phase label + transition to Done
    const af=await window.jget('/rest/api/3/issue/'+p.approved+'?fields=labels');
    const labels=(af.fields.labels||[]).filter(l=>l!=='qc-phase'&&l!=='phase-approved').concat('phase-approved-merged');
    await window.jput('/rest/api/3/issue/'+p.approved,{fields:{labels}});
    const tr=await window.jget('/rest/api/3/issue/'+p.approved+'/transitions');
    const done=(tr.transitions||[]).find(t=>t.to?.statusCategory?.key==='done');
    if(done) await window.jpost('/rest/api/3/issue/'+p.approved+'/transitions',{transition:{id:done.id}});
    res.push({epic:p.epic, ok:true, retiredApproved:p.approved, transitioned:!!done});
  }catch(e){ res.push({epic:p.epic, ok:false, err:String(e&&e.message)}); }
}
window.__migRes=res;
({applied:res.filter(r=>r.ok).length, failed:res.filter(r=>!r.ok)});
```

> Note: `phase-approved-merged` label marks retired stories for traceability (recoverable; not deleted). The `qc-phase` label removal makes the dashboard ignore the story.

- [ ] **Step 3: For any epic whose 10097 didn't re-render** (Gebsun lag), regenerate it from 10051. Verify + fix:

```js
const fix=[];
for(const p of window.__mig){
  const f=await window.jget('/rest/api/3/issue/'+p.mgmt+'?fields=customfield_10051,customfield_10097');
  const t=a=>{const o=[];const w=x=>{if(!x)return;if(Array.isArray(x))return x.forEach(w);if(x.type==='text'&&x.text)o.push(x.text);if(x.content)w(x.content);};w(a?.content);return o.join(' ');};
  const srcHas=/release approach confirmed/i.test(t(f.fields.customfield_10051));
  const renHas=/release approach confirmed/i.test(t(f.fields.customfield_10097));
  if(srcHas && !renHas){
    // regenerate 10097 from 10051 (each bullet item one line; convert inlineCard->key)
    const ZW='​'; const flat=li=>{let s='';const w=n=>{if(!n)return;if(Array.isArray(n))return n.forEach(w);if(n.type==='text')s+=n.text;else if(n.type==='inlineCard'){const u=n.attrs?.url||'';s+=u.split('/').pop().split('#')[0].split('?')[0];}else if(n.type==='hardBreak')s+=' ';if(n.content&&n.type!=='inlineCard')w(n.content);};w(li.content);return s.replace(/\s+/g,' ').trim();};
    const src=f.fields.customfield_10051; const lines=[];
    for(const n of (src.content||[])){if(n.type==='orderedList')for(const li of n.content)lines.push('# '+flat(li));else if(n.type==='bulletList')for(const li of n.content)lines.push('* '+flat(li));}
    const content=[];lines.forEach((ln,i)=>{if(i)content.push({type:'hardBreak'});content.push({type:'text',text:ZW+ln});});
    const r=await window.jput('/rest/api/3/issue/'+p.mgmt,{fields:{customfield_10097:{type:'doc',version:1,content:[{type:'paragraph',content}]}}});
    fix.push({epic:p.epic, regenerated:r.ok});
  }
}
({regenerated:fix});
```

- [ ] **Step 4: Report** applied count, any failures, any 10097 regenerations. Do not proceed to Task 7 until all epics applied ok.

---

### Task 7: Post-migration verification + cleanup

**Files:** none

- [ ] **Step 1: Verify every feature epic now has the 15-phase shape** and no live `phase-approved`:

```js
const base='https://zilmoney.atlassian.net';const enc=encodeURIComponent;
async function all(jql,fields){let o=[],t=null;do{const u=base+'/rest/api/3/search/jql?jql='+enc(jql)+'&fields='+enc(fields)+'&maxResults=100'+(t?'&nextPageToken='+enc(t):'');const r=await(await fetch(u,{credentials:'include',headers:{Accept:'application/json'}})).json();o=o.concat(r.issues||[]);t=r.nextPageToken;}while(t);return o;}
const epics=await all('issuetype = Epic AND labels = feature','summary');
const bad=[];
for(const e of epics){
  const kids=await all('parent="'+e.key+'" AND labels=qc-phase','labels');
  const labels=kids.map(k=>(k.fields.labels||[]).find(l=>l.startsWith('phase-')));
  const hasAppr=labels.includes('phase-approved');
  const hasMgmt=labels.includes('phase-mgmt-approval');
  if(hasAppr || (kids.length && !hasMgmt)) bad.push({epic:e.key, phaseCount:kids.length, hasAppr, hasMgmt});
}
({epics:epics.length, anomalies:bad});
```

Expected: `anomalies: []` (no live `phase-approved` qc-phase story remains; every provisioned epic has `phase-mgmt-approval`).

- [ ] **Step 2: Spot-check one migrated epic** — the Management Approval story shows 8 items, carried state looks right, and a previously-noted item still has its note (compare against the Task 5 dry-run record for that epic).

- [ ] **Step 3: Delete the throwaway test epic + children** from Task 3 (labelled `qc-test`). This is a WRITE and a deletion of test-only data created in this plan — confirm with the user first, then delete the test epic's children and the epic.

- [ ] **Step 4: Final report** — files changed (Tasks 1,2,4), deploy version, epics migrated, anomalies (should be none). Stage repo files (`git add`) if not already; user commits.

---

## Self-Review

**Spec coverage:**
- Framework edit (spec §4.1) → Task 1. ✓
- Provision edit (spec §4.2) → Task 2. ✓
- Skill docs (spec §4.3) → Task 4. ✓
- Migration fold + state-carry + note re-key (spec §5.1) → Tasks 5 (plan) + 6 (apply). ✓
- Retire Approved by close + de-label, not delete (spec §5.2) → Task 6 Step 2c. ✓
- New-epic provisioning + QA-Rework regression (spec §6) → Task 3. ✓
- Post-migration verification (spec §6) → Task 7. ✓
- Risk: Gebsun render fallback (spec §7) → Task 6 Step 3. ✓

**Placeholder scan:** No TBD/TODO; all steps carry real commands/code. Task 1 Step 2 provision.js has a grep-and-adapt fallback because the earlier COO cleanup may have shifted that block — this is a real safeguard, not a placeholder.

**Type/name consistency:** merged item texts identical across framework.js (Task 1), provision.js (Task 2), skill (Task 4), and migration `MERGED_ITEMS` (Task 6). Note re-key `NEWIDX` (Task 5) matches the merged order used by `buildSrc` (Task 6). Label `phase-approved` retired everywhere; retired stories carry `phase-approved-merged` for traceability.
