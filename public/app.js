const $=s=>document.querySelector(s);const topics=['Healthcare','Economy','Education','Housing','Civil rights','Immigration','Environment','Defense'];const state={members:[],votes:[],bills:[],selected:new Set(JSON.parse(localStorage.getItem('mr_topics')||'[]')),ratings:JSON.parse(localStorage.getItem('mr_ratings')||'{}')};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path){const r=await fetch(path);const d=await r.json();if(!r.ok)throw Error(d.error||'Data source unavailable');return d}
function status(msg,error=false){$('#status').className=msg?'status':'';$('#status').textContent=msg;$('#status').style.borderColor=error?'#bc6a76':''}
function renderTopics(){$('#topics').innerHTML=topics.map(t=>`<label><input type="checkbox" value="${esc(t)}" ${state.selected.has(t)?'checked':''}>${esc(t)}</label>`).join('');$('#topics').querySelectorAll('input').forEach(el=>el.onchange=()=>{el.checked?state.selected.add(el.value):state.selected.delete(el.value);localStorage.setItem('mr_topics',JSON.stringify([...state.selected]))})}
function alignment(){const ratings=Object.values(state.ratings);const rated=ratings.filter(x=>x==='agree'||x==='disagree');$('#alignment').innerHTML=rated.length?`<strong style="font-size:28px;color:#91c9ff">${Math.round(rated.filter(x=>x==='agree').length/rated.length*100)}%</strong><br>${rated.filter(x=>x==='agree').length} agreements out of ${rated.length} ratings<br><small>Across all representatives and votes you've rated</small>`:'No votes rated yet.'}
function memberOptions(){const opts=state.members.map(m=>`<option value="${esc(m.id)}">${esc(m.name)} · ${esc(m.chamber.includes('Senate')?'Senate':'House')}</option>`).join('');$('#memberSelect').innerHTML=opts;$('#billMember').innerHTML=opts}
function renderMembers(){const holder=$('#members');holder.replaceChildren();for(const m of state.members){const el=document.createElement('article');el.className='member';const img=document.createElement('img');img.alt='';img.referrerPolicy='no-referrer';if(m.image&&/^https:\/\//.test(m.image))img.src=m.image;const content=document.createElement('div');content.innerHTML=`<strong>${esc(m.name)}</strong><span>${esc(m.party)} · ${esc(m.chamber.includes('Senate')?'U.S. Senator':`U.S. House · District ${m.district}`)}</span><a href="${esc(m.profile)}" target="_blank" rel="noopener">Congress profile ↗</a>`;el.append(img,content);holder.append(el)}}
function renderVotes(){const q=$('#search').value.toLowerCase();const visible=state.votes.filter(v=>(v.question+' '+v.description+' '+v.result).toLowerCase().includes(q));$('#voteList').innerHTML=visible.length?visible.map(v=>{const rating=state.ratings[v.id];return `<article class="record"><div class="meta">${esc(v.chamber)} · Roll call ${esc(v.number)} · ${esc(v.date)}</div><h3>${esc(v.description||v.question||'Recorded vote')}</h3><p>${esc(v.question)} · Result: ${esc(v.result||'See official record')}</p><span class="pill">Representative voted: ${esc(v.position)}</span><div class="actions"><a href="${esc(v.url)}" target="_blank" rel="noopener">Official voting record ↗</a><button data-rate="agree" data-id="${esc(v.id)}" class="${rating==='agree'?'chosen':''}">I agree</button><button data-rate="disagree" data-id="${esc(v.id)}" class="${rating==='disagree'?'chosen':''}">I disagree</button><button data-rate="unsure" data-id="${esc(v.id)}" class="${rating==='unsure'?'chosen':''}">Unsure</button></div></article>`}).join(''):'<p class="sub">No matching recorded votes in the recent sample. Try another representative or keyword.</p>';$('#voteList').querySelectorAll('[data-rate]').forEach(b=>b.onclick=()=>{state.ratings[b.dataset.id]=b.dataset.rate;localStorage.setItem('mr_ratings',JSON.stringify(state.ratings));alignment();renderVotes()})}
async function loadVotes(){const m=state.members.find(m=>m.id===$('#memberSelect').value);if(!m)return;$('#voteList').innerHTML='<p class="sub">Loading recent official roll calls…</p>';$('#voteNote').textContent='';try{const chamber=m.chamber.includes('Senate')?'senate':'house';const last=m.name.split(' ').at(-1).replace(/[^a-zA-Z-]/g,'');const p=new URLSearchParams({id:m.id,chamber,name:m.name,last,state:m.state});const d=await api('/api/votes?'+p);state.votes=d.votes;$('#voteNote').textContent=d.notice+' Records are not a comprehensive voting history.';renderVotes()}catch(e){$('#voteList').innerHTML=`<p class="sub">${esc(e.message)}. Try again later or use the member's official profile.</p>`}}
async function loadBills(){const m=state.members.find(m=>m.id===$('#billMember').value);if(!m)return;$('#billList').innerHTML='<p class="sub">Loading sponsored legislation…</p>';try{const d=await api('/api/sponsored/'+encodeURIComponent(m.id));$('#billList').innerHTML=d.bills.length?d.bills.map(b=>`<article class="record"><div class="meta">${esc(b.type)} ${esc(b.number)} · ${esc(b.congress)}th Congress</div><h3>${esc(b.title)}</h3><p>${esc(b.latestAction||'No recent action supplied')} · ${esc(b.date||'')}</p><a target="_blank" rel="noopener" href="https://www.congress.gov/search?q=${encodeURIComponent(JSON.stringify({source:'legislation',search:`${b.type} ${b.number} ${b.congress}`}))}">Find on Congress.gov ↗</a></article>`).join(''):'<p class="sub">No sponsored bills returned by the source.</p>'}catch(e){$('#billList').innerHTML=`<p class="sub">${esc(e.message)}</p>`}}

$('#lookup').onsubmit = async e => {
  e.preventDefault();

  status('Finding your congressional district and representatives…');
  $('#dashboard').hidden = true;

  try {
    const address = $('#address').value.trim();

    const loc = await api(
      '/api/location?address=' + encodeURIComponent(address)
    );

    // Fallback locations must be confirmed by the visitor.
    if (loc.confirmationRequired) {
      const score = Number(loc.matchScore);
      const matchQuality = Number.isFinite(score)
        ? `Match score: ${score.toFixed(0)}/100\n`
        : '';

      const message =
        'We could not match your address directly with the Census Bureau.\n\n' +
        'Another address service found this location:\n\n' +
        loc.matchedAddress + '\n\n' +
        matchQuality +
        `Possible congressional district: ${loc.state}-${loc.district}\n\n` +
        'Does this location match your intended address?\n\n' +
        'Select OK to continue or Cancel to try another address.';

      const confirmed = window.confirm(message);

      if (!confirmed) {
        status(
          'Location not confirmed. Please check your address and try again.'
        );
        $('#address').focus();
        return;
      }
    }

    const d = await api(
      `/api/members?state=${encodeURIComponent(loc.state)}` +
      `&district=${encodeURIComponent(loc.district)}`
    );

    if (!d.members.length) {
      throw Error(
        'No current members returned for this district. ' +
        'Please verify the address or try again.'
      );
    }

    state.members = d.members;

    $('#where').textContent =
      `${loc.state} · Congressional District ${loc.district}`;

    const sourceLabel = loc.confirmationRequired
      ? 'Location confirmed using fallback geocoding'
      : 'Census matched';

    $('#matched').textContent =
      `${sourceLabel}: ${loc.matchedAddress}`;

    renderMembers();
    memberOptions();

    $('#dashboard').hidden = false;
    status('');

    await loadVotes();

  } catch (err) {
    status(err.message, true);
  }
};

$('#memberSelect').onchange=loadVotes;$('#billMember').onchange=loadBills;$('#search').oninput=renderVotes;$('#change').onclick=()=>{$('#dashboard').hidden=true;$('#address').focus();window.scrollTo({top:0,behavior:'smooth'})};document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('selected',x===b));['votes','bills','about'].forEach(t=>$('#'+t+'Tab').hidden=b.dataset.tab!==t);if(b.dataset.tab==='bills')loadBills()});renderTopics();alignment();
