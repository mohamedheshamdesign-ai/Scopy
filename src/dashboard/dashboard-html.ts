export const dashboardHtml = String.raw`<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07111f"><link rel="manifest" href="/manifest.webmanifest">
<title>Scopy — Local Workspace</title>
<style>
:root{color-scheme:dark;--bg:#07111f;--panel:#0d1b2c;--panel2:#10243a;--line:#1c3550;--text:#e8f0f8;--muted:#91a6ba;--blue:#3b82f6;--cyan:#5dd6e8;--green:#39c49a;--red:#f07878;--amber:#e9b95e;font-family:Inter,Segoe UI,Arial,sans-serif}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 20% -20%,#17385a 0,transparent 45%),var(--bg);color:var(--text);min-height:100vh}button,input,textarea,select{font:inherit}button{cursor:pointer;border:1px solid var(--line);border-radius:9px;padding:10px 14px;background:#173252;color:var(--text)}button.primary{background:linear-gradient(135deg,#2563eb,#147b9d);border:0}button.ghost{background:transparent}button.danger{color:#ffaaaa;border-color:#693c4a}.app{display:grid;grid-template-columns:240px 1fr;min-height:100vh}.side{border-right:1px solid var(--line);background:#071321dd;padding:24px 16px;display:flex;flex-direction:column;gap:24px}.brand{display:flex;align-items:center;gap:12px;padding:0 8px}.mark{width:34px;height:34px;border-radius:11px;background:linear-gradient(140deg,#1c72c7,#56d1df);display:grid;place-items:center;font-weight:800;color:#06111d}.brand strong{letter-spacing:.08em}.brand small{display:block;color:var(--muted);font-size:11px;margin-top:3px}.nav{display:grid;gap:5px}.nav button{text-align:left;background:transparent;border-color:transparent;color:var(--muted);padding:11px 12px}.nav button.active,.nav button:hover{background:#10263e;border-color:#1b3c5d;color:var(--text)}.sidefoot{margin-top:auto;color:var(--muted);font-size:11px;line-height:1.7;padding:8px}.main{padding:28px clamp(18px,4vw,56px);max-width:1600px;width:100%;margin:0 auto}.top{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:28px}.eyebrow{color:var(--cyan);text-transform:uppercase;letter-spacing:.14em;font-size:10px;font-weight:700}.top h1{margin:5px 0 0;font-size:27px}.topright{display:flex;align-items:center;gap:10px}.status{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:30px;padding:8px 12px}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:20px}.stat,.panel,.item{background:linear-gradient(145deg,#10243aee,#0b1929ee);border:1px solid var(--line);border-radius:14px}.stat{padding:16px}.stat span{font-size:12px;color:var(--muted)}.stat strong{display:block;font-size:27px;margin-top:8px}.layout{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,.8fr);gap:16px}.panel{padding:18px;margin-bottom:16px}.panelhead{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.panel h2{font-size:15px;margin:0}.muted{color:var(--muted)}.small{font-size:12px}.list{display:grid;gap:8px}.item{padding:12px;background:#0b1a2a;display:flex;justify-content:space-between;align-items:center;gap:12px}.item strong{font-size:13px}.item p{margin:5px 0 0;color:var(--muted);font-size:11px;overflow-wrap:anywhere}.pill{font-size:10px;border:1px solid var(--line);border-radius:20px;padding:5px 8px;color:var(--muted);white-space:nowrap}.pill.ok{color:var(--green);border-color:#246a5b}.pill.warn{color:var(--amber);border-color:#705b31}.pill.bad{color:var(--red);border-color:#693c4a}.form{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.form input,.form textarea,.form select,.field{background:#071522;color:var(--text);border:1px solid #24415c;border-radius:9px;padding:11px;min-width:0;flex:1}.form textarea{min-height:70px;resize:vertical}.form .wide{flex-basis:100%}.tabs{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:15px}.tabs button{font-size:12px}.chatbox{display:flex;flex-direction:column;gap:10px;min-height:360px}.messages{display:flex;flex-direction:column;gap:10px;max-height:54vh;overflow:auto;padding:4px}.msg{padding:12px 14px;border-radius:12px;max-width:92%;white-space:pre-wrap;line-height:1.6;font-size:13px}.msg.user{background:#143b61;align-self:flex-end}.msg.ai{background:#13283b;border:1px solid #24415c;align-self:flex-start}.chatinput{display:flex;gap:8px}.chatinput textarea{flex:1;min-height:54px;background:#071522;color:var(--text);border:1px solid #24415c;border-radius:10px;padding:12px;resize:vertical}.hidden{display:none!important}.empty{padding:30px;text-align:center;color:var(--muted);font-size:12px}.detail{font-size:12px;color:var(--muted);line-height:1.6}.actions{display:flex;gap:6px;flex-wrap:wrap}.actions button{font-size:11px;padding:7px 9px}.section{display:none}.section.active{display:block}.notice{padding:12px;border:1px solid #24516b;border-radius:10px;color:#a9dce9;font-size:12px;line-height:1.6;margin-bottom:14px}.dangertext{color:var(--red)}.ltr{direction:ltr}.rtl{direction:rtl;text-align:right}@media(max-width:1000px){.grid{grid-template-columns:repeat(3,1fr)}.layout{grid-template-columns:1fr}}@media(max-width:680px){.app{grid-template-columns:1fr}.side{padding:12px;border-right:0;border-bottom:1px solid var(--line)}.nav{display:flex;overflow:auto}.nav button{white-space:nowrap}.sidefoot{display:none}.main{padding:18px 12px}.grid{grid-template-columns:repeat(2,1fr)}.top{align-items:flex-start}.top h1{font-size:22px}.status{display:none}}
</style>
</head>
<body>
<div class="app">
<aside class="side">
 <div class="brand"><div class="mark">S</div><div><strong>SCOPY</strong><small>PRIVATE WORKSPACE</small></div></div>
 <nav class="nav" id="nav">
  <button class="active" data-page="overview">◈ &nbsp; Overview</button>
  <button data-page="chat">✳ &nbsp; AI Workspace</button>
  <button data-page="tasks">☷ &nbsp; Tasks</button>
  <button data-page="projects">▦ &nbsp; Projects</button>
  <button data-page="agents">◉ &nbsp; Agents</button>
  <button data-page="terminal">⌁ &nbsp; Terminal</button>
  <button data-page="browser">◎ &nbsp; Browser</button>
  <button data-page="integrations">⌘ &nbsp; Integrations</button>
  <button data-page="computer">▣ &nbsp; Computer</button>
  <button data-page="plans">⌘ &nbsp; Plans & Runs</button>
  <button data-page="memory">◌ &nbsp; Memory</button>
  <button data-page="approvals">◇ &nbsp; Approvals</button>
  <button data-page="settings">⚙ &nbsp; Settings</button>
 </nav>
 <div class="sidefoot">LOCAL-FIRST · PRIVATE BY DEFAULT<br>Execution is permission-gated.<br><span id="safetySide">Safety: strict</span></div>
</aside>
<main class="main">
 <header class="top"><div><div class="eyebrow">PERSONAL AI OPERATING SYSTEM</div><h1 id="pageTitle">Overview</h1></div><div class="topright"><span class="status" id="connection">● Local connection</span><button class="ghost" id="lang">العربية</button><button class="ghost hidden" id="installApp">Install Scopy</button><button class="ghost" id="refresh">↻ Refresh</button></div></header>
 <div id="globalNotice" class="notice hidden"></div>
 <section class="section active" id="page-overview">
  <div class="grid" id="stats"></div>
  <div class="layout"><div>
   <div class="panel"><div class="panelhead"><h2>Recent tasks</h2><button class="ghost" data-go="tasks">View all →</button></div><div class="list" id="recentTasks"></div></div>
   <div class="panel"><div class="panelhead"><h2>Recent activity</h2><span class="muted small">Audit trail</span></div><div class="list" id="activity"></div></div>
  </div><div>
   <div class="panel"><div class="panelhead"><h2>System status</h2><span class="pill ok">LOCAL</span></div><div id="systemStatus" class="list"></div></div>
   <div class="panel"><div class="panelhead"><h2>Pending approvals</h2><button class="ghost" data-go="approvals">Review →</button></div><div id="pendingPreview" class="list"></div></div>
  </div></div>
 </section>
 <section class="section" id="page-chat"><div class="layout"><div class="panel chatbox"><div class="panelhead"><h2>Talk to Scopy</h2><select id="agentSelect" style="max-width:220px" class="field"></select></div><div class="notice">Local model only. No cloud fallback. The assistant can reason and prepare plans; it cannot silently perform unsupported actions.</div><div class="messages" id="messages"><div class="msg ai">Scopy is ready. Connect your local model in this PowerShell session to start.</div></div><div class="chatinput"><textarea id="prompt" placeholder="Tell Scopy what you want to accomplish…"></textarea><button class="primary" id="send">Send ↗</button><button id="team">Ask team</button></div></div><div class="panel"><h2>Specialists</h2><p class="detail">Choose a specialist for focused reasoning. Current profiles are advisory and use the same local model and memory.</p><div class="list" id="agentCards"></div></div></div></section>
 <section class="section" id="page-tasks"><div class="panel"><div class="panelhead"><h2>Task manager</h2><span class="muted small" id="taskCount"></span></div><div class="form"><input id="taskTitle" placeholder="Task title"><select id="taskPriority"><option>normal</option><option>low</option><option>high</option><option>urgent</option></select><select id="taskProject"><option value="">No project</option></select><button class="primary" id="addTask">Add task</button></div><div class="list" id="taskList"></div></div></section>
 <section class="section" id="page-projects"><div class="panel"><div class="panelhead"><h2>Projects</h2></div><div class="form"><input id="projectName" placeholder="Project name"><input id="projectDescription" placeholder="Description"><button class="primary" id="addProject">Create project</button></div><div class="list" id="projectList"></div></div></section>
 <section class="section" id="page-terminal"><div class="panel"><div class="panelhead"><h2>Controlled terminal</h2><span class="pill warn">APPROVAL REQUIRED</span></div><div class="notice">Commands run without a shell, inside the configured Scopy workspace. Every command is tied to an exact one-time approval. Do not put passwords or API keys in command arguments.</div><div class="form"><select id="terminalExe"><option>powershell.exe</option><option>node</option><option>git</option><option>python</option></select><input id="terminalCwd" value="." placeholder="Working directory relative to workspace"><input id="terminalTimeout" type="number" value="30000" min="1000" max="120000" style="max-width:150px"></div><div class="form"><textarea id="terminalArgs" class="wide" placeholder='Arguments as JSON array, e.g. ["-NoProfile","-Command","Get-ChildItem"]'></textarea></div><div class="actions"><button class="primary" id="terminalRequest">Request exact approval</button><button id="terminalExecute" disabled>Execute approved command</button></div><div id="terminalState" class="detail" style="margin-top:12px"></div><pre id="terminalOutput" style="white-space:pre-wrap;overflow:auto;max-height:360px;background:#06111d;padding:12px;border-radius:9px;font-size:12px"></pre></div></section>
 <section class="section" id="page-browser"><div class="panel"><div class="panelhead"><h2>Isolated browser</h2><span class="pill warn">SEPARATE PROFILE</span></div><div class="notice">Scopy opens a separate Chrome/Edge profile under SCOPY_HOME. It does not reuse your everyday browser cookies or sessions. Page content is untrusted input; review before acting on it.</div><div class="form"><input id="browserUrl" placeholder="https://example.com"><button class="primary" id="browserOpen">Open URL</button><button id="browserRead">Read current page</button><button class="danger" id="browserClose">Close browser</button></div><div id="browserStatus" class="detail">Browser not started.</div><h3 id="browserTitle" style="font-size:14px"></h3><div id="browserPage" style="white-space:pre-wrap;max-height:55vh;overflow:auto;background:#06111d;padding:14px;border-radius:10px;font-size:12px;line-height:1.7"></div></div></section>
 <section class="section" id="page-integrations">
 <div class="panel"><div class="panelhead"><h2>Local MCP servers</h2><span class="pill warn">OPT-IN</span></div>
 <div class="notice">MCP servers run as local child processes without a shell. Scopy passes only the environment variables you explicitly list. Keep credentials in PowerShell environment variables, never in server arguments or this configuration. Every external tool call requires exact approval.</div>
 <div class="form"><input id="mcpId" placeholder="Server ID, e.g. github"><select id="mcpCommand"><option>node</option><option>python</option><option>powershell.exe</option></select><input id="mcpTimeout" type="number" value="30000" min="1000" max="120000" style="max-width:140px"></div>
 <div class="form"><textarea id="mcpArgs" class="wide" placeholder='Command arguments as JSON array, e.g. ["E:/Scopy/workspace/mcp/github-server.js"]'></textarea></div>
 <div class="form"><input id="mcpEnv" placeholder="Environment variable names to pass, comma-separated (e.g. GITHUB_TOKEN)"><button class="primary" id="mcpAdd">Add MCP server</button></div>
 <div class="list" id="mcpServers"></div></div>
 <div class="panel"><div class="panelhead"><h2>Discover and call tools</h2></div>
 <div class="form"><select id="mcpTool" class="wide"><option value="">Load tools from a server first</option></select><button id="mcpLoad">Load tools</button></div>
 <p id="mcpToolDescription" class="detail"></p>
 <pre id="mcpToolSchema" style="white-space:pre-wrap;max-height:220px;overflow:auto;font-size:11px"></pre>
 <div class="form"><textarea id="mcpArguments" class="wide" placeholder='Tool arguments as JSON object, e.g. {"query":"recent issues"}'></textarea></div>
 <div class="actions"><button class="primary" id="mcpRequest">Request exact approval</button><button id="mcpExecute" disabled>Execute approved tool</button></div>
 <div id="mcpState" class="detail" style="margin-top:12px"></div><pre id="mcpOutput" style="white-space:pre-wrap;max-height:320px;overflow:auto;background:#06111d;padding:12px;border-radius:9px;font-size:11px"></pre>
 </div>
</section>
<section class="section" id="page-computer">
 <div class="panel"><div class="panelhead"><h2>Windows computer control</h2><span class="pill warn">APPROVAL REQUIRED</span></div>
 <div class="notice">Uses Windows UI Automation through a fixed PowerShell script. Scopy can inspect a window's controls, invoke a uniquely matched control, or set a value. Every action requires approval. It does not use coordinates, capture screenshots, or send global keyboard shortcuts.</div>
 <div class="form"><input id="computerWindow" class="wide" placeholder="Exact window title, e.g. Untitled - Notepad"><select id="computerAction"><option value="snapshot">Inspect controls</option><option value="invoke">Invoke control</option><option value="set_value">Set control value</option></select><input id="computerLimit" type="number" value="100" min="1" max="300" style="max-width:120px"></div>
 <div class="form"><input id="computerAutomationId" placeholder="Automation ID (preferred)"><input id="computerName" placeholder="Or exact control name"></div>
 <div class="form"><textarea id="computerValue" class="wide" placeholder="Value to set (set_value only)"></textarea></div>
 <div class="actions"><button class="primary" id="computerRequest">Request exact approval</button><button id="computerExecute" disabled>Execute approved action</button></div>
 <div id="computerState" class="detail" style="margin-top:12px"></div>
 <pre id="computerOutput" style="white-space:pre-wrap;max-height:420px;overflow:auto;background:#06111d;padding:12px;border-radius:9px;font-size:11px"></pre>
 </div>
</section>
<section class="section" id="page-agents"><div class="panel"><div class="panelhead"><h2>Agent registry</h2><span class="pill warn">ADVISORY MODE</span></div><p class="detail">Each specialist has a defined role. Tool execution remains centralized in Scopy's permission and approval layer.</p><div class="list" id="agentList"></div></div></section>
 <section class="section" id="page-plans"><div class="panel"><div class="panelhead"><h2>Plan a goal</h2></div><div class="form"><input id="planGoal" placeholder="Describe an outcome for Scopy to plan"><button class="primary" id="createPlan">Generate plan</button></div><div class="list" id="planList"></div></div><div class="panel"><div class="panelhead"><h2>Execution runs</h2></div><div class="list" id="runList"></div></div></section>
 <section class="section" id="page-memory"><div class="panel"><div class="panelhead"><h2>Personal memory</h2><span class="muted small">User-confirmed records</span></div><div class="form"><select id="memoryType"><option>preference</option><option>semantic</option><option>project</option><option>procedural</option><option>episodic</option><option>working</option></select><input id="memoryScope" placeholder="Scope (global by default)"><input id="memoryContent" placeholder="What should Scopy remember?"><button class="primary" id="addMemory">Save memory</button></div><div class="list" id="memoryList"></div></div></section>
 <section class="section" id="page-approvals"><div class="panel"><div class="panelhead"><h2>Approval center</h2><span class="pill warn">EXPLICIT REVIEW</span></div><p class="detail">Approvals are bound to the exact actor, tool, action, target, and payload. They are one-time and cannot be reused for another action.</p><div class="list" id="approvalList"></div></div><div class="panel"><div class="panelhead"><h2>Permission rules</h2></div><div class="form"><input id="permActor" value="user:local" placeholder="Actor"><input id="permTool" placeholder="Tool"><input id="permAction" placeholder="Action"><input id="permTarget" placeholder="Target pattern"><select id="permEffect"><option value="approval_required">approval_required</option><option value="allow">allow</option><option value="deny">deny</option></select><button class="primary" id="addPermission">Save rule</button></div><div class="list" id="permissionList"></div></div></section>
 <section class="section" id="page-settings"><div class="layout"><div class="panel"><h2>Local environment</h2><div class="list" id="settingsList"></div></div><div class="panel"><h2>Backups</h2><p class="detail">Create a verified SQLite snapshot before major changes.</p><button class="primary" id="createBackup">Create verified backup</button><div id="backupResult" class="detail" style="margin-top:12px"></div></div></div></section>
</main>
</div>
<script>
(function(){
const $=id=>document.getElementById(id);
let token=location.hash.startsWith("#token=")?location.hash.slice(7):"";
if(token){history.replaceState(null,"",location.pathname);}
const state={data:null,lang:"en"};
const titles={overview:"Overview",chat:"AI Workspace",tasks:"Tasks",projects:"Projects",agents:"Agents",terminal:"Terminal",browser:"Browser",integrations:"Integrations",computer:"Computer",plans:"Plans & Runs",memory:"Memory",approvals:"Approvals",settings:"Settings"};
const api=async(path,method="GET",data)=>{const headers={...(token?{"authorization":"Bearer "+token}:{}),...(data?{"content-type":"application/json"}:{})};const r=await fetch(path,{method,headers,body:data?JSON.stringify(data):undefined});const v=await r.json().catch(()=>({error:"Invalid server response"}));if(!r.ok)throw new Error(v.error||("HTTP "+r.status));return v;};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const short=s=>String(s||"").length>110?String(s).slice(0,107)+"…":String(s||"");
const item=(title,sub,badge,actions)=>'<div class="item"><div style="min-width:0"><strong>'+esc(title)+'</strong><p>'+esc(sub)+'</p></div><div class="actions">'+(badge?'<span class="pill">'+esc(badge)+'</span>':"")+(actions||"")+'</div></div>';
const empty=t=>'<div class="empty">'+esc(t)+'</div>';
function showNotice(message,error=false){$("globalNotice").textContent=message;$("globalNotice").classList.remove("hidden");$("globalNotice").style.borderColor=error?"#693c4a":"#24516b";setTimeout(()=>$("globalNotice").classList.add("hidden"),7000);}
function go(page){document.querySelectorAll(".section").forEach(x=>x.classList.toggle("active",x.id==="page-"+page));document.querySelectorAll("#nav button").forEach(x=>x.classList.toggle("active",x.dataset.page===page));$("pageTitle").textContent=titles[page]||page;}
document.querySelectorAll("#nav button").forEach(b=>b.addEventListener("click",()=>go(b.dataset.page)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.go)));
function render(d){state.data=d;$("connection").textContent="● Connected · 127.0.0.1";$("safetySide").textContent="Safety: "+d.safetyProfile;
$("stats").innerHTML=[["Open tasks",d.counts.tasks],["Active projects",d.counts.projects],["Memories",d.counts.memories],["Pending approvals",d.counts.pendingApprovals],["Active runs",d.counts.running]].map(x=>'<div class="stat"><span>'+x[0]+'</span><strong>'+x[1]+'</strong></div>').join("");
$("recentTasks").innerHTML=d.tasks.slice(0,5).map(t=>item(t.title,t.description||t.id,t.status)).join("")||empty("No tasks yet.");
$("activity").innerHTML=d.audit.slice(0,8).map(a=>item(a.eventType,a.entityType+" · "+a.createdAt,"LOG")).join("")||empty("No activity yet.");
$("systemStatus").innerHTML=item("Database","Connected · SQLite","OK")+item("Local AI",d.ai.detail||"Model status",d.ai.healthy?"READY":d.ai.configured?"CHECK":"NOT SET")+item("Workspace",d.workspace,"LOCAL")+item("Safety profile","Default deny","STRICT");
$("pendingPreview").innerHTML=d.approvals.filter(a=>a.status==="pending").slice(0,4).map(a=>item(a.tool+" · "+a.action,a.target,"PENDING")).join("")||empty("No pending approvals.");
$("taskCount").textContent=d.tasks.length+" records";
$("taskList").innerHTML=d.tasks.map(t=>item(t.title,t.description||t.id,t.status,'<button data-complete="'+t.id+'">'+(t.status==="completed"?"Done":"Complete")+'</button>')).join("")||empty("Create your first task.");
$("taskProject").innerHTML='<option value="">No project</option>'+d.projects.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join("");
$("projectList").innerHTML=d.projects.map(p=>item(p.name,p.description||p.id,p.status)).join("")||empty("No projects yet.");
$("agentSelect").innerHTML=d.agents.map(a=>'<option value="'+a.id+'">'+esc(a.name)+'</option>').join("");
$("agentCards").innerHTML=d.agents.map(a=>item(a.name,a.description,"ADVISORY")).join("");
$("agentList").innerHTML=d.agents.map(a=>item(a.name,a.description,a.executionMode)).join("");
$("planList").innerHTML=d.plans.map(p=>'<div class="item"><div style="min-width:0"><strong>'+esc(p.goal)+'</strong><p>'+esc(p.summary)+'</p><details><summary class="small">Review '+p.steps.length+' plan steps and typed actions</summary><pre style="white-space:pre-wrap;max-height:280px;overflow:auto;font-size:11px">'+esc(JSON.stringify(p.steps,null,2))+'</pre></details></div><div class="actions"><span class="pill">'+esc(p.status)+'</span>'+(p.status==="draft"?'<button data-plan-approve="'+p.id+'">Approve</button><button data-plan-reject="'+p.id+'">Reject</button>':"")+(p.status==="approved"?'<button data-run="'+p.id+'">Start run</button>':"")+'</div></div>').join("")||empty("No plans. Generate one from a goal.");
$("runList").innerHTML=d.runs.map(r=>'<div class="item"><div style="min-width:0"><strong>'+esc(r.id)+'</strong><p>'+r.steps.filter(s=>s.status==="succeeded").length+' / '+r.steps.length+' steps completed</p><details><summary class="small">Inspect execution steps</summary><pre style="white-space:pre-wrap;max-height:260px;overflow:auto;font-size:11px">'+esc(JSON.stringify(r.steps,null,2))+'</pre></details></div><div class="actions"><span class="pill">'+esc(r.status)+'</span>'+(r.status==="running"?'<button data-execute="'+r.id+'">Execute ready steps</button>':"")+'</div></div>').join("")||empty("No runs yet.");
$("memoryList").innerHTML=d.memories.map(m=>item(m.content,m.type+" · "+m.scope+" · confidence "+m.confidence,"ACTIVE",'<button data-archive="'+m.id+'">Archive</button>')).join("")||empty("No saved memories.");
$("approvalList").innerHTML=d.approvals.map(a=>'<div class="item"><div style="min-width:0"><strong>'+esc(a.tool)+' / '+esc(a.action)+'</strong><p>Actor: '+esc(a.actorId)+' · Target: '+esc(a.target)+'</p><details><summary class="small">Inspect exact action payload before review</summary><pre style="white-space:pre-wrap;max-height:260px;overflow:auto;font-size:11px">'+esc(JSON.stringify(a.payload,null,2))+'</pre></details></div><div class="actions"><span class="pill">'+esc(a.status)+'</span>'+(a.status==="pending"?'<button data-approval="'+a.id+'" data-decision="approved">Approve</button><button class="danger" data-approval="'+a.id+'" data-decision="rejected">Reject</button>':"")+'</div></div>').join("")||empty("No approval requests.");
$("permissionList").innerHTML=d.permissions.map(p=>item(p.tool+" / "+p.action,p.actorId+" · "+p.targetPattern,p.effect,'<button class="danger" data-permission-delete="'+p.id+'">Remove</button>')).join("")||empty("No explicit permission rules. Default deny is active.");
$("mcpServers").innerHTML=(d.mcpServers||[]).map(s=>item(s.id,s.command+" "+s.args.join(" ")+" · env: "+s.passEnv.join(", "),"CONFIGURED",'<button data-mcp-tools="'+s.id+'">Load tools</button><button class="danger" data-mcp-remove="'+s.id+'">Remove</button>')).join("")||empty("No MCP servers configured.");
$("settingsList").innerHTML=item("Home directory","All managed data stays under SCOPY_HOME","LOCAL")+item("Workspace",d.workspace,"LOCAL")+item("Safety profile",d.safetyProfile,"ACTIVE")+item("AI model",d.ai.model||"Not connected",d.ai.healthy?"READY":"CHECK");
}
async function refresh(){try{render(await api("/api/state"));}catch(e){showNotice(e.message,true);$("connection").textContent="● Disconnected";}}
$("refresh").addEventListener("click",refresh);
$("addTask").addEventListener("click",async()=>{try{await api("/api/tasks","POST",{title:$("taskTitle").value,priority:$("taskPriority").value,projectId:$("taskProject").value});$("taskTitle").value="";await refresh();}catch(e){showNotice(e.message,true);}});
$("addProject").addEventListener("click",async()=>{try{await api("/api/projects","POST",{name:$("projectName").value,description:$("projectDescription").value});$("projectName").value="";$("projectDescription").value="";await refresh();}catch(e){showNotice(e.message,true);}});
$("addMemory").addEventListener("click",async()=>{try{await api("/api/memories","POST",{type:$("memoryType").value,scope:$("memoryScope").value||"global",content:$("memoryContent").value});$("memoryContent").value="";await refresh();}catch(e){showNotice(e.message,true);}});
$("createPlan").addEventListener("click",async()=>{try{$("createPlan").disabled=true;await api("/api/plans","POST",{goal:$("planGoal").value});$("planGoal").value="";await refresh();showNotice("Draft plan saved. Review it before starting a run.");}catch(e){showNotice(e.message,true);}finally{$("createPlan").disabled=false;}});
$("send").addEventListener("click",async()=>{const prompt=$("prompt").value.trim();if(!prompt)return;const box=$("messages");box.insertAdjacentHTML("beforeend",'<div class="msg user">'+esc(prompt)+'</div>');$("prompt").value="";$("send").disabled=true;try{const result=await api("/api/chat","POST",{prompt,agentId:$("agentSelect").value});box.insertAdjacentHTML("beforeend",'<div class="msg ai">'+esc(result.text)+'<div class="muted small" style="margin-top:8px">'+esc(result.model)+' · '+Math.round(result.durationMs/1000)+'s</div></div>');box.scrollTop=box.scrollHeight;}catch(e){showNotice(e.message,true);}finally{$("send").disabled=false;}});
$("prompt").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("send").click();}});
$("addPermission").addEventListener("click",async()=>{try{await api("/api/permissions","POST",{actorId:$("permActor").value,tool:$("permTool").value,action:$("permAction").value,targetPattern:$("permTarget").value,effect:$("permEffect").value});await refresh();}catch(e){showNotice(e.message,true);}});

let pendingTerminal=null;
function terminalPayload(){
 const args=JSON.parse($("terminalArgs").value||"[]");
 if(!Array.isArray(args)||!args.every(x=>typeof x==="string"))throw new Error("Arguments must be a JSON array of strings.");
 return {executable:$("terminalExe").value,args,workingDirectory:$("terminalCwd").value||".",timeoutMs:Number($("terminalTimeout").value||30000)};
}



let pendingComputer=null;
$("computerRequest").addEventListener("click",async()=>{
 try{
  const computerAction=$("computerAction").value;
  const windowTitle=$("computerWindow").value;
  let payload={};
  if(computerAction==="snapshot")payload={limit:Number($("computerLimit").value||100)};
  else{
   const automationId=$("computerAutomationId").value.trim();
   const name=$("computerName").value.trim();
   if(Boolean(automationId)===Boolean(name))throw new Error("Provide exactly one Automation ID or exact control name.");
   payload=automationId?{automationId}:{name};
   if(computerAction==="set_value")payload.value=$("computerValue").value;
  }
  pendingComputer={computerAction,windowTitle,payload};
  const approval=await api("/api/computer/requests","POST",{computerAction,windowTitle,...payload});
  pendingComputer.requestId=approval.id;
  $("computerState").textContent="Approval request "+approval.id+" created. Inspect the exact window and control details in Approvals.";
  $("computerExecute").disabled=true;await refresh();
 }catch(e){showNotice(e.message,true);}
});
$("computerExecute").addEventListener("click",async()=>{
 if(!pendingComputer||!pendingComputer.approvalId){showNotice("Approve the exact computer action first.",true);return;}
 try{
  $("computerExecute").disabled=true;$("computerState").textContent="Executing approved Windows UI Automation action…";
  const r=await api("/api/computer/execute","POST",{...pendingComputer,approvalId:pendingComputer.approvalId});
  $("computerOutput").textContent=JSON.stringify(r.output,null,2);$("computerState").textContent="Completed in "+r.durationMs+" ms.";pendingComputer=null;await refresh();
 }catch(e){$("computerState").textContent=e.message;showNotice(e.message,true);}finally{$("computerExecute").disabled=true;}
});

let pendingMcp=null;
let availableMcpTools=[];
window.selectedMcpServer=null;
$("mcpAdd").addEventListener("click",async()=>{
 try{
  const args=JSON.parse($("mcpArgs").value||"[]");
  const passEnv=$("mcpEnv").value.split(",").map(x=>x.trim()).filter(Boolean);
  if(!Array.isArray(args)||!args.every(x=>typeof x==="string"))throw new Error("MCP args must be a JSON array of strings.");
  await api("/api/mcp/servers","POST",{id:$("mcpId").value,command:$("mcpCommand").value,args,passEnv,timeoutMs:Number($("mcpTimeout").value||30000)});
  $("mcpId").value="";$("mcpArgs").value="";await refresh();showNotice("MCP server configuration saved. Credentials remain in the selected PowerShell environment variables.");
 }catch(e){showNotice(e.message,true);}
});
$("mcpLoad").addEventListener("click",async()=>{
 if(!window.selectedMcpServer){showNotice("Select Load tools beside a configured MCP server first.",true);return;}
 try{
  $("mcpState").textContent="Starting MCP server and discovering tools…";
  const r=await api("/api/mcp/servers/"+window.selectedMcpServer+"/tools","POST",{});
  availableMcpTools=r.tools||[];
  $("mcpTool").innerHTML=availableMcpTools.map(t=>'<option value="'+esc(t.name)+'">'+esc(t.name)+'</option>').join("")||'<option value="">No tools exposed</option>';
  const selected=availableMcpTools[0];$("mcpToolDescription").textContent=selected?.description||"";
  $("mcpToolSchema").textContent=selected?JSON.stringify(selected.inputSchema||{},null,2):"";
  $("mcpState").textContent="Discovered "+availableMcpTools.length+" tools from "+window.selectedMcpServer+".";
 }catch(e){$("mcpState").textContent=e.message;showNotice(e.message,true);}
});
$("mcpTool").addEventListener("change",()=>{
 const t=availableMcpTools.find(x=>x.name===$("mcpTool").value);
 $("mcpToolDescription").textContent=t?.description||"";
 $("mcpToolSchema").textContent=t?JSON.stringify(t.inputSchema||{},null,2):"";
});
$("mcpRequest").addEventListener("click",async()=>{
 try{
  const args=JSON.parse($("mcpArguments").value||"{}");
  if(!args||typeof args!=="object"||Array.isArray(args))throw new Error("MCP arguments must be a JSON object.");
  if(!window.selectedMcpServer||!$("mcpTool").value)throw new Error("Select an MCP server and tool first.");
  pendingMcp={serverId:window.selectedMcpServer,toolName:$("mcpTool").value,arguments:args};
  const a=await api("/api/mcp/requests","POST",pendingMcp);pendingMcp.requestId=a.id;pendingMcp.serverFingerprint=a.payload.serverFingerprint;
  $("mcpState").textContent="Approval request "+a.id+" created. Inspect its exact arguments in Approvals.";
  $("mcpExecute").disabled=true;await refresh();
 }catch(e){showNotice(e.message,true);}
});
$("mcpExecute").addEventListener("click",async()=>{
 if(!pendingMcp||!pendingMcp.approvalId){showNotice("Approve the exact MCP request first.",true);return;}
 try{$("mcpExecute").disabled=true;$("mcpState").textContent="Executing approved MCP tool…";
  const result=await api("/api/mcp/execute","POST",{...pendingMcp,approvalId:pendingMcp.approvalId});
  $("mcpOutput").textContent=JSON.stringify(result.output,null,2);$("mcpState").textContent="MCP call completed in "+result.durationMs+" ms.";pendingMcp=null;await refresh();
 }catch(e){$("mcpState").textContent=e.message;showNotice(e.message,true);}finally{$("mcpExecute").disabled=true;}
});

$("browserOpen").addEventListener("click",async()=>{try{$("browserStatus").textContent="Starting isolated browser…";const r=await api("/api/browser/open","POST",{url:$("browserUrl").value});$("browserStatus").textContent=r.url;$("browserTitle").textContent=r.title;$("browserPage").textContent=r.text;}catch(e){showNotice(e.message,true);$("browserStatus").textContent=e.message;}});
$("browserRead").addEventListener("click",async()=>{try{const r=await api("/api/browser/read");$("browserStatus").textContent=r.url;$("browserTitle").textContent=r.title;$("browserPage").textContent=r.text;}catch(e){showNotice(e.message,true);}});
$("browserClose").addEventListener("click",async()=>{try{await api("/api/browser/close","POST",{});$("browserStatus").textContent="Browser closed.";$("browserPage").textContent="";}catch(e){showNotice(e.message,true);}});
$("team").addEventListener("click",async()=>{const prompt=$("prompt").value.trim();if(!prompt)return;const ids=["brand-designer","business-operator","marketing-strategist"];const box=$("messages");box.insertAdjacentHTML("beforeend",'<div class="msg user">'+esc(prompt)+' <span class="pill">TEAM</span></div>');$("prompt").value="";$("team").disabled=true;try{const r=await api("/api/delegate","POST",{prompt,agentIds:ids});box.insertAdjacentHTML("beforeend",'<div class="msg ai">'+esc(r.synthesis)+'<div class="muted small">Sequential specialist review · '+esc(r.model)+'</div></div>');box.scrollTop=box.scrollHeight;}catch(e){showNotice(e.message,true);}finally{$("team").disabled=false;}});

$("terminalRequest").addEventListener("click",async()=>{
 try{pendingTerminal=terminalPayload();const approval=await api("/api/terminal/requests","POST",pendingTerminal);pendingTerminal.requestId=approval.id;$("terminalState").textContent="Approval request created: "+approval.id+". Review it in Approvals, then execute the same command."; $("terminalExecute").disabled=true;await refresh();showNotice("Terminal command is waiting for your approval.");}
 catch(e){showNotice(e.message,true);}
});
$("terminalExecute").addEventListener("click",async()=>{
 if(!pendingTerminal||!pendingTerminal.approvalId){showNotice("Create and approve an exact command request first.",true);return;}
 try{$("terminalExecute").disabled=true;$("terminalState").textContent="Running approved command…";const result=await api("/api/terminal/execute","POST",{...pendingTerminal,approvalId:pendingTerminal.approvalId});$("terminalOutput").textContent="Exit code: "+result.output.exitCode+"\n\nSTDOUT\n"+result.output.stdout+"\n\nSTDERR\n"+result.output.stderr; $("terminalState").textContent="Completed in "+result.durationMs+" ms.";pendingTerminal=null;await refresh();}
 catch(e){$("terminalState").textContent=e.message;showNotice(e.message,true);}finally{$("terminalExecute").disabled=true;}
});

$("createBackup").addEventListener("click",async()=>{try{$("backupResult").textContent="Creating and verifying…";const r=await api("/api/backups","POST");$("backupResult").textContent="Verified: "+r.name+" · schema "+r.migrationVersion;}catch(e){$("backupResult").textContent=e.message;showNotice(e.message,true);}});
document.body.addEventListener("click",async e=>{const b=e.target.closest("button");if(!b)return;try{
if(b.dataset.complete){await api("/api/tasks/"+b.dataset.complete,"PATCH",{status:"completed"});await refresh();}
if(b.dataset.planApprove||b.dataset.planReject){const id=b.dataset.planApprove||b.dataset.planReject;await api("/api/plans/"+id+"/review","POST",{decision:b.dataset.planApprove?"approved":"rejected"});await refresh();}
if(b.dataset.run){await api("/api/runs","POST",{planId:b.dataset.run});await refresh();}
if(b.dataset.execute){const r=await api("/api/runs/"+b.dataset.execute+"/execute","POST",{});await refresh();showNotice(r.pausedAt?"Run paused: "+r.pausedAt.reason:"Run updated.");}
if(b.dataset.approval){await api("/api/approvals/"+b.dataset.approval+"/review","POST",{decision:b.dataset.decision});if(pendingTerminal&&b.dataset.decision==="approved"&&pendingTerminal.requestId===b.dataset.approval){pendingTerminal.approvalId=b.dataset.approval;$("terminalExecute").disabled=false;$("terminalState").textContent="Exact command approved. You can execute it now.";}if(pendingMcp&&b.dataset.decision==="approved"&&pendingMcp.requestId===b.dataset.approval){pendingMcp.approvalId=b.dataset.approval;$("mcpExecute").disabled=false;$("mcpState").textContent="Exact MCP call approved. Execute it when ready.";}if(pendingComputer&&b.dataset.decision==="approved"&&pendingComputer.requestId===b.dataset.approval){pendingComputer.approvalId=b.dataset.approval;$("computerExecute").disabled=false;$("computerState").textContent="Exact computer action approved. Execute it when ready.";}await refresh();}
if(b.dataset.archive){await api("/api/memories/"+b.dataset.archive+"/archive","POST",{});await refresh();}
if(b.dataset.permissionDelete){await api("/api/permissions/"+b.dataset.permissionDelete,"DELETE");await refresh();}
if(b.dataset.mcpTools){window.selectedMcpServer=b.dataset.mcpTools;go("integrations");$("mcpState").textContent="Selected server: "+window.selectedMcpServer;const r=await api("/api/mcp/servers/"+window.selectedMcpServer+"/tools","POST",{});availableMcpTools=r.tools||[];$("mcpTool").innerHTML=availableMcpTools.map(t=>'<option value="'+esc(t.name)+'">'+esc(t.name)+'</option>').join("")||'<option value="">No tools exposed</option>';const t=availableMcpTools[0];$("mcpToolDescription").textContent=t?.description||"";$("mcpToolSchema").textContent=t?JSON.stringify(t.inputSchema||{},null,2):"";$("mcpState").textContent="Discovered "+availableMcpTools.length+" tools.";}
if(b.dataset.mcpRemove){await api("/api/mcp/servers/"+b.dataset.mcpRemove,"DELETE");await refresh();}
}catch(err){showNotice(err.message,true);}});
$("lang").addEventListener("click",()=>{const ar=document.documentElement.lang!=="ar";document.documentElement.lang=ar?"ar":"en";document.documentElement.dir=ar?"rtl":"ltr";$("lang").textContent=ar?"English":"العربية";showNotice(ar?"الواجهة في وضع RTL. أسماء الأقسام والأوامر التقنية ستظل بالإنجليزية.":"Interface returned to English.");});
if(token){const bootstrapToken=token;fetch("/api/session",{method:"POST",headers:{"authorization":"Bearer "+bootstrapToken}}).then(r=>{if(r.ok)token="";}).catch(()=>{});}refresh();
if("serviceWorker" in navigator){navigator.serviceWorker.register("/sw.js").catch(()=>{});}
let installPrompt=null;window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installPrompt=e;$("installApp").classList.remove("hidden");});$("installApp").addEventListener("click",async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$("installApp").classList.add("hidden");});
})();
</script>
</body></html>`;
