exports.handler = async function(event) {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    // Accept either {durations:[..]} or {samples:[{duration, syllables}, ...]}
    const durations = Array.isArray(body.durations) ? body.durations.map(Number).filter(d=>!isNaN(d) && d>0) : [];
    let samples = Array.isArray(body.samples) ? body.samples.filter(s=>s && s.duration) : [];
    // If durations provided, convert to samples with unknown syllables
    if (durations.length && !samples.length) {
      samples = durations.map(d=>({duration: Number(d), syllables: null}));
    }
    const count = samples.length;
    if (!count) return { statusCode:400, body: JSON.stringify({ error:'no samples provided' }) };

    const totalSec = samples.reduce((s,it)=>s + Number(it.duration || 0), 0);
    const avgSec = totalSec / count;
    // compute avg seconds per syllable if syllables data provided for any
    const syllTotal = samples.reduce((s,it)=> s + (Number(it.syllables) || 0), 0);
    const hasSyll = syllTotal > 0;
    const secPerSyll = hasSyll ? (totalSec / syllTotal) : null;

    const result = {
      samples: count,
      avgSeconds: Number(avgSec.toFixed(3)),
      secPerSyll: secPerSyll ? Number(secPerSyll.toFixed(4)) : null,
      note: hasSyll ? 'sec per syllable computed' : 'provide samples[].syllables to compute sec/syllable'
    };

    return { statusCode:200, body: JSON.stringify(result) };
  } catch (err){
    return { statusCode:500, body: JSON.stringify({ error: String(err) }) };
  }
};
