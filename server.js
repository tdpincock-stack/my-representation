import express from 'express';
import {XMLParser} from 'fast-xml-parser';
const app=express();app.disable('x-powered-by');app.use(express.static('public'));const PORT=process.env.PORT||3000;
const API='https://api.congress.gov/v3';const xml=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_'});
const cached=new Map();async function get(url,ttl=900000,asXml=false){const c=cached.get(url);if(c&&Date.now()-c.time<ttl)return c.data;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),14000);try{const r=await fetch(url,{signal:controller.signal,headers:{'User-Agent':'MyRepresentation/1.0 (civic transparency app)'}});if(!r.ok)throw Error(`Source returned ${r.status}`);const data=asXml?xml.parse(await r.text()):await r.json();cached.set(url,{time:Date.now(),data});return data}finally{clearTimeout(timer)}}
function congress(path){if(!process.env.CONGRESS_API_KEY)throw Error('CONGRESS_API_KEY is missing. Add it to your environment.');const u=new URL(API+path);u.searchParams.set('api_key',process.env.CONGRESS_API_KEY);u.searchParams.set('format','json');return get(u.toString())}
function handler(fn){return async(req,res)=>{try{res.json(await fn(req))}catch(e){console.error(e.message);res.status(502).json({error:e.message})}}}
const stateCodes=new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
function currentCongress(){return Math.floor((new Date().getUTCFullYear()-2025)/2)+119}function session(){return new Date().getUTCFullYear()%2===1?1:2}

function findDistrict(geographies) {
  const groups = Object.entries(geographies || {})
    .filter(([name]) => /congressional districts/i.test(name))
    .flatMap(([, items]) => Array.isArray(items) ? items : []);

  const current = groups.find(d => d.CD119 !== undefined)
    || groups.find(d => d.CD118 !== undefined)
    || groups[0];

  const raw = current?.CD119 ?? current?.CD118
    ?? current?.BASENAME ?? current?.CD;

  if (raw === undefined || raw === null) {
    throw Error('No congressional district was returned for this location.');
  }

  const district = Number(raw);
  if (!Number.isInteger(district) || district < 0 || district > 53) {
    throw Error('The congressional district result was invalid.');
  }

  return district;
}

app.get('/api/location', handler(async req => {
  const address = String(req.query.address || '').trim();

  if (address.length < 8 || address.length > 250) {
    throw Error('Enter a complete U.S. street address (8–250 characters).');
  }

  const censusUrl = new URL(
    'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress'
  );

  censusUrl.search = new URLSearchParams({
    address,
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    format: 'json'
  });

  let censusResult;

  try {
    censusResult = await get(censusUrl.toString(), 86400000);
  } catch (error) {
    console.error('Census address lookup failed:', error.message);
  }

  const match = censusResult?.result?.addressMatches?.[0];

  if (match) {
    const state = String(match.addressComponents?.state || '').toUpperCase();

    if (!stateCodes.has(state)) {
      throw Error('Could not determine the state.');
    }

    return {
      state,
      district: findDistrict(match.geographies),
      matchedAddress: match.matchedAddress,
      congress: currentCongress(),
      confirmationRequired: false,
      lookupMethod: 'census-address'
    };
  }

  // Fallback: geocode the address using ArcGIS.
  const arcUrl = new URL(
    'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates'
  );

  arcUrl.search = new URLSearchParams({
    SingleLine: address,
    f: 'json',
    outFields: 'Addr_type,RegionAbbr,Country',
    sourceCountry: 'USA',
    maxLocations: '1',
    forStorage: 'false'
  });

  const arcResult = await get(arcUrl.toString(), 86400000);

  if (arcResult.error) {
    throw Error('The fallback address service is unavailable.');
  }

  const candidate = arcResult.candidates?.[0];

  if (!candidate || candidate.score < 85) {
    throw Error(
      'Neither address service found a reliable match. Please verify your address.'
    );
  }

  const type = candidate.attributes?.Addr_type;

  if (!['PointAddress', 'Subaddress', 'StreetAddress'].includes(type)) {
    throw Error(
      'Only an approximate street or area was found. Please use a more precise address.'
    );
  }

  const latitude = Number(candidate.location?.y);
  const longitude = Number(candidate.location?.x);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw Error('The fallback service did not return valid coordinates.');
  }

  const coordUrl = new URL(
    'https://geocoding.geo.census.gov/geocoder/geographies/coordinates'
  );

  coordUrl.search = new URLSearchParams({
    x: String(longitude),
    y: String(latitude),
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    format: 'json'
  });

  const coordinateResult = await get(coordUrl.toString(), 86400000);
  const geographies = coordinateResult?.result?.geographies;

  const states = Object.entries(geographies || {})
    .filter(([name]) => /^states$/i.test(name))
    .flatMap(([, values]) => Array.isArray(values) ? values : []);

  const state = String(
    candidate.attributes?.RegionAbbr || states[0]?.STUSAB || ''
  ).toUpperCase();

  if (!stateCodes.has(state)) {
    throw Error('Could not determine the state from the fallback location.');
  }

  return {
    state,
    district: findDistrict(geographies),
    matchedAddress: candidate.address,
    congress: currentCongress(),
    confirmationRequired: true,
    lookupMethod: 'arcgis-coordinates',
    matchScore: candidate.score,
    matchType: type,
    approximateLocation: { latitude, longitude }
  };
}));
app.get('/api/members',handler(async req=>{const state=String(req.query.state||'').toUpperCase(),district=Number(req.query.district);if(!stateCodes.has(state)||!Number.isInteger(district)||district<0||district>53)throw Error('Invalid state or district.');const d=await congress(`/member/${state}?currentMember=true&limit=250`);const members=(d.members||[]).filter(m=>m.currentMember!==false).filter(m=>{const terms=m.terms?.item||[];const latest=terms.at(-1);const chamber=(latest?.chamber||'').toLowerCase();return chamber==='senate'||(chamber==='house of representatives'&&Number(m.district??latest?.district)===district)});return {members:members.map(m=>({id:m.bioguideId,name:m.name||m.directOrderName||m.fullName,party:m.party,state:m.state,district:m.district,chamber:(m.terms?.item||[]).at(-1)?.chamber||'',image:m.depiction?.imageUrl||null,profile:`https://www.congress.gov/member/${m.bioguideId}`})),source:'Congress.gov',retrievedAt:new Date().toISOString()}}));
app.get('/api/sponsored/:id',handler(async req=>{const id=req.params.id;if(!/^[A-Z]\d{6}$/.test(id))throw Error('Invalid Bioguide ID');const d=await congress(`/member/${id}/sponsored-legislation?limit=20`);return {bills:(d.sponsoredLegislation||[]).map(b=>({title:b.title,number:b.number,type:b.type,congress:b.congress,url:b.url?.replace('api.congress.gov/v3/bill/','www.congress.gov/bill/')||null,latestAction:b.latestAction?.text,date:b.latestAction?.actionDate})),source:'Congress.gov'}}));
function array(v){return v==null?[]:Array.isArray(v)?v:[v]}function text(v){return typeof v==='object'?(v?.['#text']??''):v??''}

app.get('/api/votes', handler(async req => {
  const chamber = String(req.query.chamber || 'house').toLowerCase();
  const id = String(req.query.id || '');
  const congressNumber = currentCongress();
  const sess = session();

  if (!/^[A-Z]\d{6}$/.test(id)) {
    throw Error('Invalid member ID');
  }

  // Keep the existing Senate implementation separate for now.
  if (chamber === 'senate') {
    throw Error(
      'Senate voting records are temporarily unavailable while we update the data source.'
    );
  }

  if (chamber !== 'house') {
    throw Error('Invalid chamber');
  }

  const listing = await congressRequest(
    `/house-vote/${congressNumber}/${sess}?limit=10`
  );

  const entries = listing.houseRollCallVotes
    || listing.houseVotes
    || [];

  if (!Array.isArray(entries)) {
    throw Error('Unexpected House vote listing format.');
  }

  if (entries.length === 0) {
    return {
      votes: [],
      checked: 0,
      failed: 0,
      source: 'Congress.gov',
      notice: 'The source returned no House roll calls for this session.'
    };
  }

  const votes = [];
  let failed = 0;
  let checked = 0;

  // Only inspect five votes initially.
  // Process sequentially to avoid overwhelming the API.
  for (const item of entries.slice(0, 5)) {
    const num = item.rollCallNumber
      ?? item.voteNumber
      ?? item.number;

    if (num == null) {
      failed++;
      console.error('House vote: missing roll call number');
      continue;
    }

    try {
      const base =
        `/house-vote/${congressNumber}/${sess}/${num}`;

      const detail = await congressRequest(base);

      const memberData = await congressRequest(
        `${base}/members?limit=500`
      );

      const vote = detail.houseRollCallVote
        || detail.houseVote
        || {};

      const container =
        memberData.houseRollCallVoteMemberVotes
        || memberData.members
        || [];

      const records = Array.isArray(container)
        ? container
        : container.results || container.members || [];

      if (!Array.isArray(records)) {
        throw Error('Unexpected member voting data format.');
      }

      checked++;

      const person = records.find(record =>
        record.bioguideId === id ||
        record.member?.bioguideId === id
      );

      if (!person) {
        console.error(
          `House vote ${num}: member ${id} not found in returned records`
        );
        continue;
      }

      votes.push({
        id: `house-${congressNumber}-${sess}-${num}`,
        chamber: 'House',
        number: num,
        date: vote.startDate
          || vote.date
          || item.startDate
          || '',
        question: vote.voteQuestion
          || vote.question
          || item.voteQuestion
          || 'Roll call vote',
        description: vote.voteDescription
          || vote.description
          || item.voteDescription
          || '',
        result: vote.result
          || vote.voteResult
          || '',
        position: person.voteCast
          || person.vote
          || person.position
          || 'Unknown',
        url: `https://clerk.house.gov/Votes/${new Date().getUTCFullYear()}${String(num).padStart(3, '0')}`
      });

    } catch (error) {
      failed++;
      console.error(`House vote ${num}: ${error.message}`);
    }
  }

  // Do not report an API failure as an absence of voting records.
  if (checked === 0 && failed > 0) {
    throw Error(
      `House voting data could not be retrieved. ${failed} lookups failed.`
    );
  }

  if (votes.length === 0 && checked > 0) {
    throw Error(
      'Vote records were retrieved, but this representative could not be matched. The voting data format may need updating.'
    );
  }

  votes.sort((a, b) => Number(b.number) - Number(a.number));

  return {
    votes,
    checked,
    failed,
    source: 'Congress.gov',
    notice:
      `Checked ${checked} recent House roll calls. ` +
      `${failed} lookups failed. ` +
      'This is a limited sample, not a complete voting history.'
  };
}));

const listing=await congressRequest(`/house-vote/${congress}/${sess}?limit=35`);const entries=listing.houseRollCallVotes||listing.houseVotes||[];
 await Promise.all(entries.slice(0,22).map(async v=>{try{const num=v.rollCallNumber??v.voteNumber??v.number;const [detail,memberData]=await Promise.all([congressRequest(`/house-vote/${congress}/${sess}/${num}`),congressRequest(`/house-vote/${congress}/${sess}/${num}/members?limit=500`)]);const vote=detail.houseRollCallVote||detail.houseVote||{};const records=memberData.houseRollCallVoteMemberVotes?.results||memberData.houseRollCallVoteMemberVotes||memberData.members||[];const person=array(records).find(x=>x.bioguideId===id||x.member?.bioguideId===id);if(person)votes.push({id:`house-${congress}-${sess}-${num}`,chamber:'House',number:num,date:vote.startDate||vote.date||v.startDate||'',question:vote.voteQuestion||vote.question||v.voteQuestion||'Roll call vote',description:vote.voteDescription||vote.description||v.voteDescription||'',result:vote.result||vote.voteResult||'',position:person.voteCast||person.vote||person.position||'Unknown',url:`https://clerk.house.gov/Votes/${new Date().getUTCFullYear()}${String(num).padStart(3,'0')}`})}catch(e){console.error('House vote',e.message)}}));
}else if(chamber==='senate'){
 const list=await get(`https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${congress}_${sess}.xml`,900000,true);const items=array(list?.vote_summary?.votes?.vote||list?.vote_summary?.vote);await Promise.all(items.slice(0,24).map(async item=>{try{const num=String(text(item.vote_number||item['@_vote_number']||item.vote_num)).padStart(5,'0');if(!/^\d{5}$/.test(num))return;const data=await get(`https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${sess}/vote_${congress}_${sess}_${num}.xml`,900000,true);const roll=data.roll_call_vote||{};const members=array(roll.members?.member);const member=members.find(m=>m.lis_member_id===id||m.bioguide_id===id||String(m.member_full||'').toLowerCase()===String(req.query.name||'').toLowerCase()|| (String(m.last_name||'').toLowerCase()===String(req.query.last||'').toLowerCase()&&String(m.state||'').toUpperCase()===String(req.query.state||'').toUpperCase()));if(member)votes.push({id:`senate-${congress}-${sess}-${num}`,chamber:'Senate',number:Number(num),date:text(roll.vote_date),question:text(roll.vote_question_text),description:text(roll.vote_title)||text(roll.document?.document_title),result:text(roll.vote_result),position:text(member.vote_cast),url:`https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${sess}/vote_${congress}_${sess}_${num}.htm`})}catch(e){console.error('Senate vote',e.message)}}));
}else throw Error('Invalid chamber');return {votes:votes.sort((a,b)=>b.number-a.number),checked:chamber==='house'?22:24,source:chamber==='house'?'Congress.gov / House Clerk':'U.S. Senate',notice:'Recent roll calls only; not a complete voting history. Votes may be delayed or missing if the source is unavailable.'}}));
async function congressRequest(path){const u=new URL(API+path);u.searchParams.set('api_key',process.env.CONGRESS_API_KEY||'');u.searchParams.set('format','json');return get(u.toString())}
app.get('/api/health',(req,res)=>res.json({ok:true,congressApiConfigured:!!process.env.CONGRESS_API_KEY}));
app.listen(PORT,()=>console.log(`My Representation: http://localhost:${PORT}`));
