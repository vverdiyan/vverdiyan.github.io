const dataset = window.GDPVAL_DATASET;
const previewManifest = window.GDPVAL_PREVIEW_MANIFEST || { byId: {} };
window.__GDPVAL_PREVIEWS = window.__GDPVAL_PREVIEWS || {};

if (!dataset) {
  document.body.innerHTML = '<main style="padding:32px;font-family:sans-serif">GDPval V5 assets are missing.</main>';
  throw new Error('GDPval V5 assets are missing.');
}

const refs = {
  sectorSelect: document.getElementById('sector-select'),
  occupationSelect: document.getElementById('occupation-select'),
  occupationSearch: document.getElementById('occupation-search'),
  viewSwitch: document.getElementById('view-switch'),
  focusCard: document.getElementById('focus-card'),
  viewContent: document.getElementById('view-content'),
  previewPanel: document.getElementById('preview-panel'),
  toolbarGrid: document.querySelector('.toolbar-grid'),
  toolbarScopeNote: document.getElementById('toolbar-scope-note'),
  workspace: document.querySelector('.workspace'),
  previewColumn: document.querySelector('.preview-column'),
};
refs.sectorField = refs.sectorSelect?.closest('.field') || null;
refs.occupationField = refs.occupationSelect?.closest('.field') || null;
refs.searchField = refs.occupationSearch?.closest('.field') || null;

const currentLeaderboardModels = [...(dataset.models || [])].sort((a, b) => (a.overallRank || 9999) - (b.overallRank || 9999));
const currentLeaderboardSource = dataset.leaderboards?.current || {};
const currentMetrics = dataset.currentMetrics || {};

const state = {
  sector: 'All sectors',
  occupation: dataset.summary.defaultOccupation,
  search: '',
  view: 'models',
  selectedTaskId: null,
  selectedAttachmentId: null,
  previewTab: 'overview',
  previewLoading: false,
  previewError: '',
};

const decoder = document.createElement('textarea');
const previewPromises = new Map();
const viewTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'models', label: 'Leaderboard' },
  { id: 'efficiency', label: 'Economics' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'files', label: 'Files' },
  { id: 'sources', label: 'Sources' },
];
const previewTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'tables', label: 'Tables' },
  { id: 'text', label: 'Text' },
  { id: 'open', label: 'Source' },
];
const sectors = ['All sectors', ...dataset.sectors.map((sector) => sector.name)];
const occupationRecords = dataset.occupations.map((occupation) => ({
  ...occupation,
  key: occupationKey(occupation.sector, occupation.name),
}));
const tasksByOccupation = groupBy(dataset.tasks, (task) => occupationKey(task.sector, task.occupation));
const filesByOccupation = groupBy(dataset.attachments, (file) => occupationKey(file.sector, file.occupation));
const filesByTask = groupBy(dataset.attachments, (file) => file.taskId);
const tasksById = new Map(dataset.tasks.map((task) => [task.taskId, task]));
const filesById = new Map(dataset.attachments.map((file) => [file.id, file]));
const occupationMetaByKey = new Map(occupationRecords.map((occupation) => [occupation.key, occupation]));

function occupationKey(sector, occupation) {
  return `${sector}||${occupation}`;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatElo(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(0) : '-';
}

function formatCi(lower, upper) {
  const low = Number(lower);
  const high = Number(upper);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return '-';
  return `${low.toFixed(0)} / +${high.toFixed(0)}`;
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = Number(value);
  let idx = 0;
  while (amount >= 1024 && idx < units.length - 1) {
    amount /= 1024;
    idx += 1;
  }
  return `${amount.toFixed(amount >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function formatDecimal(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '-';
}

function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n < 1
    ? `$${n.toFixed(4)}`
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function modelMetricUrl(row) {
  const url = row?.detailsUrl || '';
  return url.startsWith('http') ? url : `https://artificialanalysis.ai${url}`;
}

function costTotal(row) {
  return ['answer', 'reasoning', 'cacheWrite', 'cacheHit', 'input']
    .reduce((sum, key) => sum + Number(row?.[key] || 0), 0);
}

function tokenTotal(row) {
  return Number(row?.answer || 0) + Number(row?.reasoning || 0);
}

function shortText(value, length = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

function fileHref(relativePath) {
  const value = String(relativePath || '');
  return /^[a-z]+:\/\//i.test(value) ? value : value.split('/').map(encodeURIComponent).join('/');
}

function fileName(file) {
  return String(file?.basename || file?.path || file?.localPath || '').split('/').pop() || 'File';
}

function cleanCell(value) {
  const raw = String(value ?? '');
  const noTags = raw.replace(/<[^>]+>/g, ' ');
  decoder.innerHTML = noTags;
  return decoder.value.replace(/\s+/g, ' ').trim();
}

function verificationChecks() {
  return dataset.verification?.checks || [];
}

function verificationPassed() {
  return verificationChecks().filter((check) => check.passed).length;
}

function formatVerifiedAt() {
  const value = dataset.verification?.verifiedAt;
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function isGlobalView() {
  return ['models', 'efficiency', 'sources'].includes(state.view);
}

function needsPreviewColumn() {
  return !['models', 'efficiency', 'sources'].includes(state.view);
}

function toolbarScopeCopy() {
  if (state.view === 'models') {
    return 'The current GDPval-AA leaderboard is benchmark-wide, so sector and subfield filters are not used in this view.';
  }
  if (state.view === 'efficiency') {
    return 'Economics uses the current GDPval-AA cost, token, and turn rows, so sector and subfield filters are not used in this view.';
  }
  if (state.view === 'sources') {
    return 'Sources documents the data contract for v2; filters are not used in this view.';
  }
  return '';
}

function occupationsBySector() {
  return occupationRecords.filter((occupation) => state.sector === 'All sectors' || occupation.sector === state.sector);
}

function visibleOccupations() {
  const bySector = occupationsBySector();
  if (!state.search) return bySector;
  return bySector.filter((occupation) => `${occupation.name} ${occupation.sector}`.toLowerCase().includes(state.search));
}

function currentOccupationRecord() {
  return occupationRecords.find((occupation) => occupation.name === state.occupation) || occupationRecords[0];
}

function currentTasks() {
  const occupation = currentOccupationRecord();
  return tasksByOccupation.get(occupation.key) || [];
}

function currentFiles() {
  const occupation = currentOccupationRecord();
  return [...(filesByOccupation.get(occupation.key) || [])].sort((a, b) => {
    if (Number(b.previewAvailable) !== Number(a.previewAvailable)) return Number(b.previewAvailable) - Number(a.previewAvailable);
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return fileName(a).localeCompare(fileName(b));
  });
}

function currentTask() {
  const tasks = currentTasks();
  return tasks.find((task) => task.taskId === state.selectedTaskId) || tasks[0] || null;
}

function selectedFile() {
  return state.selectedAttachmentId ? filesById.get(state.selectedAttachmentId) || null : null;
}

function previewEntry(fileId) {
  return previewManifest?.byId?.[fileId] || null;
}

function previewPayload(fileId) {
  return window.__GDPVAL_PREVIEWS[fileId] || null;
}

function syncState() {
  const bySector = occupationsBySector();
  const visible = visibleOccupations();
  const pool = visible.length ? visible : bySector.length ? bySector : occupationRecords;

  if (!pool.some((occupation) => occupation.name === state.occupation)) {
    state.occupation = pool[0]?.name || dataset.summary.defaultOccupation;
  }

  const tasks = currentTasks();
  if (!tasks.some((task) => task.taskId === state.selectedTaskId)) {
    state.selectedTaskId = tasks[0]?.taskId || null;
  }

  const files = currentFiles();
  if (!files.some((file) => file.id === state.selectedAttachmentId)) {
    state.selectedAttachmentId = null;
    state.previewTab = 'overview';
    state.previewLoading = false;
    state.previewError = '';
  }

}

function renderSectorSelect() {
  refs.sectorSelect.innerHTML = sectors.map((sectorName) => `<option value="${esc(sectorName)}" ${state.sector === sectorName ? 'selected' : ''}>${esc(sectorName)}</option>`).join('');
}

function renderOccupationSelect() {
  const visible = visibleOccupations();
  const fallback = occupationsBySector();
  const options = visible.length ? visible : fallback;
  refs.occupationSelect.innerHTML = options.length
    ? options.map((occupation) => `<option value="${esc(occupation.name)}" ${state.occupation === occupation.name ? 'selected' : ''}>${esc(occupation.name)}${state.search && !visible.length ? ' (closest sector match)' : ''}</option>`).join('')
    : '<option value="">No matching subfield</option>';
  refs.occupationSelect.disabled = !options.length;
}

function renderViewSwitch() {
  const counts = {
    overview: 'Key takeaways',
    models: `${currentLeaderboardModels.length} current models`,
    efficiency: `${(currentMetrics.costPerTask || []).length} cost rows`,
    tasks: `${currentTasks().length} public tasks`,
    files: `${currentFiles().length} linked files`,
    sources: 'Data contract',
  };
  refs.viewSwitch.innerHTML = viewTabs.map((tab) => `
    <button class="switch-pill ${state.view === tab.id ? 'is-active' : ''}" data-action="select-view" data-view="${tab.id}">
      <strong>${esc(tab.label)}</strong>
      <span class="note">${esc(counts[tab.id])}</span>
    </button>
  `).join('');
}

function renderOccupationFocusCard() {
  const occupation = currentOccupationRecord();
  const tasks = currentTasks();
  const files = currentFiles();
  const rubricItems = tasks.reduce((sum, task) => sum + Number(task.rubricCount || 0), 0);
  return `
    <div class="focus-top">
      <div>
        <p class="section-kicker">Subfield</p>
        <h2>${esc(occupation.name)}</h2>
        <div class="badge-row">
          <span class="badge soft">${esc(occupation.sector)}</span>
          ${occupation.isInvestor ? '<span class="badge good">Investor subset</span>' : ''}
          <span class="badge soft">${tasks.length} public tasks</span>
          <span class="badge soft">${files.length} linked files</span>
        </div>
      </div>
    </div>
    <div class="focus-stats focus-stats-compact">
      <div class="mini-stat">
        <div class="stat-label">Tasks</div>
        <strong>${tasks.length}</strong>
        <div class="note">Hugging Face task rows</div>
      </div>
      <div class="mini-stat">
        <div class="stat-label">Rubric items</div>
        <strong>${formatInteger(rubricItems)}</strong>
        <div class="note">summed from task rubrics</div>
      </div>
    </div>
    <p class="note focus-note">This subfield view is current for the public GDPval task corpus. v2 does not show model-by-occupation scores because the current GDPval-AA source publishes overall model metrics, not per-occupation score payloads.</p>
  `;
}

function renderLeaderboardFocusCard() {
  const topModel = currentLeaderboardModels[0];
  const topOpenAiModel = currentLeaderboardModels.find((model) => model.provider === 'openai');
  return `
    <div class="focus-top">
      <div>
        <p class="section-kicker">Leaderboard</p>
        <h2>Current GDPval-AA v2 results</h2>
        <p class="lede">Benchmark-wide current model results from ${esc(currentLeaderboardSource.name || 'the current leaderboard')}.</p>
        <div class="badge-row">
          ${topModel ? `<span class="badge good">Top model: ${esc(topModel.label)} - ${formatElo(topModel.gdpvalAaElo)} Elo</span>` : ``}
          ${topOpenAiModel ? `<span class="badge soft">Top OpenAI: ${esc(topOpenAiModel.label)} - ${formatElo(topOpenAiModel.gdpvalAaElo)} Elo</span>` : ``}
        </div>
      </div>
    </div>
  `;
}

function renderEfficiencyFocusCard() {
  const costRows = currentMetrics.costPerTask || [];
  const tokenRows = currentMetrics.outputTokensPerTask || [];
  const turnRows = currentMetrics.averageTurnsPerTask || [];
  const cheapest = costRows[0];
  return `
    <div class="focus-top">
      <div>
        <p class="section-kicker">Economics</p>
        <h2>Current cost, token, and turn metrics</h2>
        <p class="lede">GDPval-AA v2 publishes current model economics alongside Elo. This tab uses those current rows directly, without archived occupation scores.</p>
        <div class="badge-row">
          <span class="badge soft">${costRows.length} cost rows</span>
          <span class="badge soft">${tokenRows.length} token rows</span>
          <span class="badge soft">${turnRows.length} turn rows</span>
          ${cheapest ? `<span class="badge good">Lowest listed cost: ${esc(cheapest.label)} - ${formatCurrency(costTotal(cheapest))}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderSourcesFocusCard() {
  return `
    <div class="focus-top">
      <div>
        <p class="section-kicker">Sources</p>
        <h2>v2 source contract</h2>
        <p class="lede">This page separates current model metrics from the GDPval task corpus so the dashboard does not imply unsupported per-occupation current model scores.</p>
      </div>
    </div>
  `;
}

function renderFocusCard() {
  refs.focusCard.innerHTML = state.view === 'models'
    ? renderLeaderboardFocusCard()
    : state.view === 'efficiency'
      ? renderEfficiencyFocusCard()
      : state.view === 'sources'
        ? renderSourcesFocusCard()
        : renderOccupationFocusCard();
}

function renderTaskTable(tasks, actionLabel = 'Open detail', action = 'go-task') {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Rubric</th>
            <th>Points</th>
            <th>Files</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${tasks.map((task) => `
            <tr class="${state.selectedTaskId === task.taskId ? 'is-selected' : ''}">
              <td>
                <strong>${esc(shortText(task.promptPreview, 122))}</strong>
                <div class="task-preview">${esc(task.promptPreview)}</div>
              </td>
              <td>${task.rubricCount}</td>
              <td>${task.positivePoints}</td>
              <td>${task.attachmentCount}</td>
              <td><button class="table-button" data-action="${action}" data-task-id="${task.taskId}">${esc(actionLabel)}</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}
function renderCurrentLeaderboardPanel() {
  const topRows = currentLeaderboardModels.slice(0, 6);
  const topOpenAiModel = currentLeaderboardModels.find((model) => model.provider === 'openai');
  const max = Math.max(...topRows.map((row) => Number(row.gdpvalAaElo || 0)), 1);
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Current leaderboard</p>
          <h3>GDPval-AA v2 Elo</h3>
        </div>
        <span class="badge soft">${currentLeaderboardModels.length} models</span>
      </div>
      <p class="note panel-subnote">Current overall rows come from ${esc(currentLeaderboardSource.name || 'Artificial Analysis GDPval-AA v2')}. They are not per-occupation rows.</p>
      <div class="bar-stack">
        ${topRows.map((row) => `
          <div class="bar-row">
            <div class="row-head">
              <strong>${esc(row.label)}</strong>
              <span class="note">${esc(row.providerLabel || row.provider || '-')} · ${formatElo(row.gdpvalAaElo)} Elo</span>
            </div>
            <div class="track">
              <span class="fill-base" style="width:${(Number(row.gdpvalAaElo || 0) / max) * 100}%"></span>
            </div>
          </div>
        `).join('')}
      </div>
      ${topOpenAiModel ? `<p class="note panel-subnote">Top OpenAI row: ${esc(topOpenAiModel.label)} at ${formatElo(topOpenAiModel.gdpvalAaElo)} Elo.</p>` : ''}
    </article>
  `;
}

function renderTaskScopePanel() {
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Task corpus</p>
          <h3>Hugging Face GDPval gold subset</h3>
        </div>
        <span class="badge soft">${dataset.summary.taskCount} tasks</span>
      </div>
      <div class="metric-grid">
        <div class="metric-cell">
          <div class="key-label">Sectors</div>
          <div class="metric-value">${dataset.summary.sectorCount}</div>
        </div>
        <div class="metric-cell">
          <div class="key-label">Occupations</div>
          <div class="metric-value">${dataset.summary.occupationCount}</div>
        </div>
        <div class="metric-cell">
          <div class="key-label">Linked files</div>
          <div class="metric-value">${dataset.summary.attachmentCount}</div>
        </div>
        <div class="metric-cell">
          <div class="key-label">Finance tasks</div>
          <div class="metric-value">${dataset.summary.financeTaskCount}</div>
        </div>
      </div>
      <p class="note panel-subnote">Hugging Face supplies prompts, rubrics, occupations, sectors, task IDs, and file links. It does not supply the current model leaderboard.</p>
    </article>
  `;
}

function renderSourceContractPanel() {
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">No-Frankenstein contract</p>
          <h3>What v2 will and will not claim</h3>
        </div>
        <span class="badge good">current-source aligned</span>
      </div>
      <div class="check-stack">
        <div class="check-row compact">
          <div class="row-head compact"><strong>Current model rankings</strong><span class="note">Artificial Analysis GDPval-AA v2 Elo</span></div>
        </div>
        <div class="check-row compact">
          <div class="row-head compact"><strong>Current economics</strong><span class="note">AA cost, token, and turn rows where published</span></div>
        </div>
        <div class="check-row compact">
          <div class="row-head compact"><strong>Task and file explorer</strong><span class="note">Hugging Face openai/gdpval public task corpus</span></div>
        </div>
        <div class="check-row compact">
          <div class="row-head compact"><strong>Not shown in v2</strong><span class="note">Historical occupation score rows without a current source</span></div>
        </div>
      </div>
    </article>
  `;
}

function renderAttachmentPanel(files) {
  const grouped = [...groupBy(files, (file) => file.fileType || 'unknown').entries()]
    .map(([type, rows]) => ({ type, total: rows.length }))
    .sort((a, b) => b.total - a.total || a.type.localeCompare(b.type));
  const max = Math.max(...grouped.map((row) => row.total), 1);
  return     `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Files</p>
          <h3>File types</h3>
        </div>
        <span class="badge soft">${files.length} files</span>
      </div>
      <div class="type-stack">
        ${grouped.map((row) => `
          <div class="type-row">
            <strong>${esc(row.type.toUpperCase())}</strong>
            <div class="type-track">
              <span class="type-base" style="width:${(row.total / max) * 100}%"></span>
            </div>
            <span class="note">${row.total}</span>
          </div>
        `).join('') || '<div class="empty-state"><div class="empty-copy">No files are indexed for this occupation.</div></div>'}
      </div>
    </article>
  `;
}

function renderVerificationPanel() {
  const checks = verificationChecks();
  return     `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Checks</p>
          <h3>Dataset and files</h3>
        </div>
        <span class="badge good">${verificationPassed()}/${checks.length}</span>
      </div>
      <p class="note panel-subnote">Verified ${esc(formatVerifiedAt())}. Counts match the published public snapshot used by this dashboard.</p>
      <div class="check-stack">
        ${checks.map((check) => `
          <div class="check-row compact">
            <div class="row-head compact">
              <strong>${esc(check.label)}</strong>
              <div class="row-tail">
                <span class="note">${esc(check.actual)} actual · ${esc(check.expected)} expected</span>
                ${check.passed ? '' : '<span class="badge alert">Mismatch</span>'}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </article>
  `;
}

function renderTaskFiles(task) {
  const files = [...(filesByTask.get(task.taskId) || [])].sort((a, b) => {
    if (Number(b.previewAvailable) !== Number(a.previewAvailable)) return Number(b.previewAvailable) - Number(a.previewAvailable);
    return fileName(a).localeCompare(fileName(b));
  });
  if (!files.length) {
    return '<div class="empty-state"><div class="empty-copy">This task has no public files attached.</div></div>';
  }
  return `
    <div class="list-stack">
      ${files.map((file) => `
        <div class="file-row">
          <div class="row-head">
            <strong>${esc(fileName(file))}</strong>
            <div class="badge-row">
              <span class="badge soft">${esc(file.fileType.toUpperCase())}</span>
              <span class="badge ${file.kind === 'reference' ? 'soft' : 'warn'}">${esc(file.kind)}</span>
            </div>
          </div>
          <div class="note">${formatBytes(file.size)} · official file link</div>
          <div class="inline-actions">
            <button class="small-button" data-action="open-file" data-file-id="${file.id}">Inspect</button>
            <a href="${esc(file.url)}" target="_blank" rel="noreferrer">Open source</a>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderOverviewView() {
  const tasks = currentTasks();
  const files = currentFiles();
  return     `
    <div class="panel-grid two">
      ${renderCurrentLeaderboardPanel()}
      ${renderTaskScopePanel()}
    </div>
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Tasks</p>
          <h3>Public task rows</h3>
        </div>
        <span class="badge soft">${tasks.length} tasks</span>
      </div>
      ${renderTaskTable(tasks)}
    </article>
    <div class="panel-grid two">
      ${renderAttachmentPanel(files)}
      ${renderSourceContractPanel()}
    </div>
  `;
}

function renderTasksView() {
  const tasks = currentTasks();
  const task = currentTask();
  return     `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Tasks</p>
          <h3>All task rows</h3>
        </div>
        <span class="badge soft">${tasks.length} rows</span>
      </div>
      ${renderTaskTable(tasks, 'Select task', 'select-task')}
    </article>
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Task detail</p>
          <h3>${task ? esc(shortText(task.promptPreview, 110)) : 'No task selected'}</h3>
        </div>
        ${task ? `<a href="${esc(task.viewerUrl)}" target="_blank" rel="noreferrer">Open task row</a>` : ''}
      </div>
      ${task ? `
        <div class="badge-row">
          <span class="badge soft">${task.rubricCount} rubric items</span>
          <span class="badge soft">${task.positivePoints} positive points</span>
          <span class="badge soft">${task.attachmentCount} files</span>
        </div>
        <div class="detail-grid">
          <div>
            <h3>Prompt</h3>
            <div class="long-text">${esc(task.prompt)}</div>
          </div>
          <div>
            <h3>Rubric</h3>
            <div class="long-text">${esc(task.rubricPretty)}</div>
          </div>
        </div>
        <div>
          <h3>Files</h3>
          ${renderTaskFiles(task)}
        </div>
      ` : '<div class="empty-state"><div class="empty-copy">No task is available for this filter.</div></div>'}
    </article>
  `;
}
function renderFilesView() {
  const files = currentFiles();
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Files</p>
          <h3>Public file inventory</h3>
        </div>
        <div class="badge-row">
          <span class="badge soft">${files.length} files</span>
          <span class="badge soft">${files.filter((file) => file.kind === 'reference').length} reference</span>
          <span class="badge soft">${files.filter((file) => file.kind === 'deliverable').length} deliverable</span>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Type</th>
              <th>Role</th>
              <th>Task Rubric</th>
              <th>Size</th>
              <th>Source</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${files.map((file) => {
              const task = tasksById.get(file.taskId);
              return `
                <tr class="${state.selectedAttachmentId === file.id ? 'is-selected' : ''}">
                  <td>
                    <strong>${esc(fileName(file))}</strong>
                    <div class="task-preview">${esc(shortText(task?.promptPreview || 'Task unavailable', 112))}</div>
                  </td>
                  <td>${esc(file.fileType.toUpperCase())}</td>
                  <td>${esc(file.kind)}</td>
                  <td>${task ? task.rubricCount : '-'}</td>
                  <td>${formatBytes(file.size)}</td>
                  <td><a href="${esc(file.url)}" target="_blank" rel="noreferrer">Open</a></td>
                  <td><button class="table-button" data-action="open-file" data-file-id="${file.id}">Inspect</button></td>
                </tr>
              `;
            }).join('') || '<tr><td colspan="7">No files are indexed for this occupation.</td></tr>'}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderModelsView() {
  const scores = currentLeaderboardModels;
  const metricLabel = 'Elo';
  const metricValue = (row) => formatElo(row.gdpvalAaElo);
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Model table</p>
          <h3>Current overall results</h3>
        </div>
        <span class="badge soft">${scores.length} models</span>
      </div>
      <p class="note panel-subnote">${esc(currentLeaderboardSource.name || 'Current leaderboard')} is benchmark-wide. It does not change with sector or subfield selection. v2 does not display per-occupation model scores unless a current source publishes them.</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Model</th>
              <th>Provider</th>
              <th>${esc(metricLabel)}</th>
              <th>CI</th>
              <th>Release</th>
            </tr>
          </thead>
          <tbody>
            ${scores.map((row) => `
              <tr>
                <td>${row.overallRank}</td>
                <td><strong>${esc(row.label)}</strong>${row.hidden ? '<div class="note">hidden row</div>' : ''}</td>
                <td>${esc(row.providerLabel || row.provider || '-')}</td>
                <td>${metricValue(row)}</td>
                <td>${formatCi(row.ciLowerDelta, row.ciUpperDelta)}</td>
                <td>${esc(row.releaseDateText || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderCostRows() {
  const rows = currentMetrics.costPerTask || [];
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Cost</p>
          <h3>Cost per task</h3>
        </div>
        <span class="badge soft">${rows.length} current rows</span>
      </div>
      <p class="note panel-subnote">Rows are sorted as published by AA. Total is calculated locally as answer + reasoning + cache write + cache hit + input.</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Total</th>
              <th>Answer</th>
              <th>Reasoning</th>
              <th>Cache write</th>
              <th>Cache hit</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td><a href="${esc(modelMetricUrl(row))}" target="_blank" rel="noreferrer"><strong>${esc(row.label)}</strong></a></td>
                <td>${formatCurrency(costTotal(row))}</td>
                <td>${formatCurrency(row.answer)}</td>
                <td>${formatCurrency(row.reasoning)}</td>
                <td>${formatCurrency(row.cacheWrite)}</td>
                <td>${formatCurrency(row.cacheHit)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderTokenRows() {
  const rows = currentMetrics.outputTokensPerTask || [];
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Output</p>
          <h3>Output tokens per task</h3>
        </div>
        <span class="badge soft">${rows.length} current rows</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Total</th>
              <th>Answer</th>
              <th>Reasoning</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td><a href="${esc(modelMetricUrl(row))}" target="_blank" rel="noreferrer"><strong>${esc(row.label)}</strong></a></td>
                <td>${formatInteger(tokenTotal(row))}</td>
                <td>${formatInteger(row.answer)}</td>
                <td>${formatInteger(row.reasoning)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderTurnRows() {
  const rows = currentMetrics.averageTurnsPerTask || [];
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Agent loop</p>
          <h3>Average turns per task</h3>
        </div>
        <span class="badge soft">${rows.length} current rows</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Average turns</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td><a href="${esc(modelMetricUrl(row))}" target="_blank" rel="noreferrer"><strong>${esc(row.label)}</strong></a></td>
                <td>${formatDecimal(row.averageTurnsPerTask, 1)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderEfficiencyView() {
  return `
    ${renderCostRows()}
    ${renderTokenRows()}
    ${renderTurnRows()}
  `;
}

function renderSourcesView() {
  const notes = dataset.leaderboards?.notes || [];
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Data contract</p>
          <h3>Current v2 source map</h3>
        </div>
        <span class="badge good">no archived active tabs</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Dashboard surface</th>
              <th>Source</th>
              <th>Fields used</th>
              <th>Current?</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Leaderboard</strong></td>
              <td><a href="${esc(currentLeaderboardSource.url || 'https://artificialanalysis.ai/evaluations/gdpval-aa')}" target="_blank" rel="noreferrer">${esc(currentLeaderboardSource.name || 'Artificial Analysis GDPval-AA v2')}</a></td>
              <td>Rank, provider, model, Elo, CI, release date</td>
              <td><span class="badge good">Yes</span></td>
            </tr>
            <tr>
              <td><strong>Economics</strong></td>
              <td><a href="https://artificialanalysis.ai/evaluations/gdpval-aa" target="_blank" rel="noreferrer">Artificial Analysis GDPval-AA v2</a></td>
              <td>Cost per task, output tokens per task, average turns per task</td>
              <td><span class="badge good">Yes</span></td>
            </tr>
            <tr>
              <td><strong>Tasks and files</strong></td>
              <td><a href="${esc(dataset.source?.attachmentRoot || 'https://huggingface.co/datasets/openai/gdpval')}" target="_blank" rel="noreferrer">Hugging Face openai/gdpval</a></td>
              <td>Task IDs, sectors, occupations, prompts, rubrics, file URLs</td>
              <td><span class="badge good">Yes</span></td>
            </tr>
            <tr>
              <td><strong>Per-occupation model scores</strong></td>
              <td>Not shown in v2</td>
              <td>Current source not available from AA/HF</td>
              <td><span class="badge warn">Absent by design</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      ${notes.length ? `<div class="check-stack">${notes.map((note) => `<div class="check-row compact"><div class="row-head compact"><strong>Note</strong><span class="note">${esc(note)}</span></div></div>`).join('')}</div>` : ''}
    </article>
  `;
}

function renderViewContent() {
  if (state.view === 'tasks') {
    refs.viewContent.innerHTML = renderTasksView();
    return;
  }
  if (state.view === 'files') {
    refs.viewContent.innerHTML = renderFilesView();
    return;
  }
  if (state.view === 'models') {
    refs.viewContent.innerHTML = renderModelsView();
    return;
  }
  if (state.view === 'efficiency') {
    refs.viewContent.innerHTML = renderEfficiencyView();
    return;
  }
  if (state.view === 'sources') {
    refs.viewContent.innerHTML = renderSourcesView();
    return;
  }
  refs.viewContent.innerHTML = renderOverviewView();
}

function renderPreviewTable(table) {
  const rows = table.rows || [];
  return `
    <div class="preview-box">
      <div class="preview-head">
        <strong>${esc(table.title || 'Table')}</strong>
        <span class="note">${table.totalRows || rows.length} row(s) · ${table.totalCols || (rows[0]?.length || 0)} column(s)</span>
      </div>
      <div class="preview-table-wrap">
        <table class="preview-table">
          <tbody>
            ${rows.map((row, rowIndex) => `
              <tr>
                ${row.map((cell) => rowIndex === 0
                  ? `<th>${esc(cleanCell(cell) || ' ')}</th>`
                  : `<td>${esc(cleanCell(cell) || ' ')}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${table.truncated ? '<div class="note">Preview truncated at build time.</div>' : ''}
    </div>
  `;
}

function renderPreviewPanel() {
  if (state.view === 'models') {
    refs.previewPanel.innerHTML = `
      <div>
        <p class="preview-kicker">Leaderboard</p>
        <h3>Source links</h3>
        <p class="empty-copy">Use the official benchmark links to cross-check the published results and task materials.</p>
      </div>
      <div class="preview-stack">
        <div class="preview-box">
          <div class="inline-actions">
            <a href="https://artificialanalysis.ai/evaluations/gdpval-aa" target="_blank" rel="noreferrer">Open current leaderboard</a>
            <a href="https://huggingface.co/datasets/openai/gdpval" target="_blank" rel="noreferrer">Open Hugging Face dataset</a>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const file = selectedFile();
  if (!file) {
    refs.previewPanel.innerHTML = `
      <div class="preview-empty">
        <div>
          <p class="preview-kicker">Preview</p>
          <h3>No file selected</h3>
          <p class="empty-copy">Select a file from Tasks or Files to inspect the source material and extracted preview content.</p>
        </div>
      </div>
    `;
    return;
  }

  const entry = previewEntry(file.id);
  const payload = previewPayload(file.id);
  const task = tasksById.get(file.taskId);
  const textBlocks = payload?.textBlocks || [];
  const tables = payload?.tables || [];

  let body = '';
  if (state.previewLoading) {
    body = '<div class="empty-state"><div class="empty-copy">Loading preview payload…</div></div>';
  } else if (state.previewError) {
    body = `<div class="empty-state"><div class="empty-copy">${esc(state.previewError)}</div></div>`;
  } else if (state.previewTab === 'tables') {
    body = tables.length ? `<div class="preview-stack">${tables.slice(0, 6).map(renderPreviewTable).join('')}</div>` : '<div class="empty-state"><div class="empty-copy">No extracted tables are available for this file.</div></div>';
  } else if (state.previewTab === 'text') {
    body = textBlocks.length ? `<div class="preview-text-list">${textBlocks.slice(0, 26).map((block) => `<div class="text-block"><strong>${esc(block.label || 'Block')}</strong>${esc(block.text || '')}</div>`).join('')}</div>` : '<div class="empty-state"><div class="empty-copy">No extracted text blocks are available for this file.</div></div>';
  } else if (state.previewTab === 'open') {
    body = `
      <div class="preview-stack">
        <div class="preview-box">
          <div class="inline-actions">
            <a href="${esc(file.url)}" target="_blank" rel="noreferrer">Open source</a>

            ${task ? `<a href="${esc(task.viewerUrl)}" target="_blank" rel="noreferrer">Open task row</a>` : ''}
          </div>
        </div>
        <div class="key-grid">
          <div><div class="key-label">Source URL</div><div><a href="${esc(file.url)}" target="_blank" rel="noreferrer">${esc(file.url || '-')}</a></div></div>
          <div><div class="key-label">Dataset Path</div><div>${esc(file.path || payload?.sourcePath || '-')}</div></div>
          <div><div class="key-label">HF URI</div><div>${esc(file.hfUri || '-')}</div></div>
        </div>
      </div>
    `;
  } else {
    body = `
      <div class="preview-stack">
        <div class="preview-box">
          <div class="note">${esc(payload?.summary || 'No extracted summary is available for this file.')}</div>
          ${entry && !entry.supportsInline ? '<div class="note" style="margin-top:8px;">Inline extraction is unavailable for this file here. Use Open File for the official source document.</div>' : ''}
        </div>
        <div class="key-grid">
          <div><div class="key-label">Type</div><div>${esc(file.fileType.toUpperCase())}</div></div>
          <div><div class="key-label">Role</div><div>${esc(file.kind)}</div></div>
          <div><div class="key-label">Size</div><div>${formatBytes(file.size)}</div></div>
          <div><div class="key-label">Task</div><div>${task ? esc(shortText(task.promptPreview, 72)) : 'Unavailable'}</div></div>
        </div>
        ${textBlocks.length ? `<div class="preview-text-list">${textBlocks.slice(0, 5).map((block) => `<div class="text-block"><strong>${esc(block.label || 'Block')}</strong>${esc(block.text || '')}</div>`).join('')}</div>` : ''}
      </div>
    `;
  }

  refs.previewPanel.innerHTML = `
    <div>
      <p class="preview-kicker">Preview</p>
      <h3>${esc(fileName(file))}</h3>
      <div class="badge-row">
        <span class="badge soft">${esc(file.fileType.toUpperCase())}</span>
        <span class="badge ${file.kind === 'reference' ? 'soft' : 'warn'}">${esc(file.kind)}</span>
        <span class="badge ${entry?.supportsInline ? 'good' : 'warn'}">${entry?.supportsInline ? 'inline preview' : 'open only'}</span>
      </div>
    </div>
    <div class="inline-actions">
      <button class="small-button" data-action="clear-preview">Clear selection</button>
    </div>
    <div class="preview-tab-row">
      ${previewTabs.map((tab) => `<button class="preview-tab ${state.previewTab === tab.id ? 'is-active' : ''}" data-action="preview-tab" data-preview-tab="${tab.id}">${esc(tab.label)}</button>`).join('')}
    </div>
    ${body}
  `;
}
function renderAll() {
  syncState();
  renderSectorSelect();
  renderOccupationSelect();
  const globalView = isGlobalView();
  refs.sectorSelect.disabled = false;
  refs.occupationSelect.disabled = refs.occupationSelect.disabled;
  refs.occupationSearch.disabled = false;
  refs.occupationSearch.placeholder = 'Search occupations';
  refs.sectorField?.classList.toggle('is-hidden', globalView);
  refs.occupationField?.classList.toggle('is-hidden', globalView);
  refs.searchField?.classList.toggle('is-hidden', globalView);
  refs.toolbarGrid?.classList.toggle('is-global', globalView);
  if (refs.toolbarScopeNote) {
    refs.toolbarScopeNote.hidden = !globalView;
    refs.toolbarScopeNote.textContent = toolbarScopeCopy();
  }
  refs.workspace?.classList.toggle('no-preview', !needsPreviewColumn());
  refs.previewColumn?.classList.toggle('is-hidden', !needsPreviewColumn());
  renderViewSwitch();
  renderFocusCard();
  renderViewContent();
  if (needsPreviewColumn()) {
    renderPreviewPanel();
  }
}

function ensurePreviewLoaded(fileId) {
  if (previewPayload(fileId)) return Promise.resolve(previewPayload(fileId));
  const entry = previewEntry(fileId);
  if (!entry?.supportsInline || !entry?.scriptPath) {
    return Promise.resolve(null);
  }
  if (!previewPromises.has(fileId)) {
    previewPromises.set(fileId, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = entry.scriptPath;
      script.onload = () => resolve(previewPayload(fileId));
      script.onerror = () => reject(new Error('Failed to load preview payload.'));
      document.head.appendChild(script);
    }));
  }
  return previewPromises.get(fileId);
}

async function openFileInPanel(fileId) {
  const file = filesById.get(fileId);
  if (!file) return;
  state.selectedAttachmentId = fileId;
  state.selectedTaskId = file.taskId;
  state.previewTab = 'overview';
  state.previewError = '';
  state.previewLoading = true;
  renderAll();
  try {
    await ensurePreviewLoaded(fileId);
  } catch (error) {
    if (state.selectedAttachmentId === fileId) {
      state.previewError = error.message;
    }
  } finally {
    if (state.selectedAttachmentId === fileId) {
      state.previewLoading = false;
      renderPreviewPanel();
    }
  }
}

refs.sectorSelect.addEventListener('change', (event) => {
  state.sector = event.target.value || 'All sectors';
  state.selectedTaskId = null;
  renderAll();
});

refs.occupationSelect.addEventListener('change', (event) => {
  state.occupation = event.target.value || dataset.summary.defaultOccupation;
  state.selectedTaskId = null;
  renderAll();
});

refs.occupationSearch.addEventListener('input', (event) => {
  state.search = String(event.target.value || '').trim().toLowerCase();
  renderAll();
});

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.getAttribute('data-action');

  if (action === 'select-view') {
    state.view = target.getAttribute('data-view') || 'overview';
    renderAll();
    return;
  }

  if (action === 'select-task') {
    state.selectedTaskId = target.getAttribute('data-task-id');
    renderAll();
    return;
  }

  if (action === 'go-task') {
    state.selectedTaskId = target.getAttribute('data-task-id');
    state.view = 'tasks';
    renderAll();
    return;
  }

  if (action === 'open-file') {
    void openFileInPanel(target.getAttribute('data-file-id'));
    return;
  }

  if (action === 'preview-tab') {
    state.previewTab = target.getAttribute('data-preview-tab') || 'overview';
    renderPreviewPanel();
    return;
  }

  if (action === 'clear-preview') {
    state.selectedAttachmentId = null;
    state.previewTab = 'overview';
    state.previewLoading = false;
    state.previewError = '';
    renderPreviewPanel();
  }
});

renderAll();
