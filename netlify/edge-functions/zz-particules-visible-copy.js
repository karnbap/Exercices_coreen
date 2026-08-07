export default async (request, context) => {
  const response = await context.next();
  const type = response.headers.get('content-type') || '';
  if (!response.ok || !type.includes('text/html')) return response;

  let html = await response.text();
  const replacements = [
    [
      '<h1>La structure basique : le coréen vs le français</h1>',
      '<h1>La structure de base : le coréen vs le français</h1>'
    ],
    [
      "<h2>1️⃣ L'ordre des mots : le verbe à la fin !</h2>",
      "<h2>1️⃣ L'ordre des mots : le prédicat généralement à la fin</h2>"
    ],
    [
      "En coréen, <strong>le verbe est toujours à la fin de la phrase</strong>. On place d'abord les noms (avec leurs particules), puis l'action.",
      "En coréen, <strong>le prédicat (verbe ou adjectif) se place généralement à la fin de la phrase</strong>. Pour commencer, retiens le schéma simple : noms + particules, puis prédicat."
    ],
    [
      "Chaque nom est accompagné d'une petite particule qui indique <strong>son rôle</strong> dans la phrase : sujet, objet, lieu, temps… Grâce à elles, on sait immédiatement qui fait quoi, <strong>quel que soit l'ordre des mots</strong>.",
      "Les noms <strong>peuvent être suivis</strong> de petites particules qui indiquent leur rôle dans la phrase : sujet, objet, lieu, temps… Grâce à elles, le rôle des mots reste souvent clair <strong>même lorsque l'ordre varie</strong>."
    ],
    [
      '제<span class="particule">가</span><span class="role">Sujet</span> 폴이에요. — <em>Je suis Paul.</em> (De qui parle-t-on ? → de moi, qu\'on décrit !)',
      '누가 폴이에요? — 제<span class="particule">가</span><span class="role">Sujet</span> 폴이에요. — <em>Qui est Paul ? — C’est moi.</em> (Ici, 제가 met l’accent sur « moi ».)'
    ],
    [
      "Dis-nous qui tu es : tes résultats pourront t'être envoyés par email (et le chat saura à qui ronronner dessus 🐱).",
      "Dis-nous qui tu es : tes résultats pourront t'être envoyés par email."
    ]
  ];

  for (const [from, to] of replacements) html = html.replace(from, to);

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-cache');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
};

export const config = {
  path: [
    '/assignments/particules_sujet_objet_00',
    '/assignments/particules_sujet_objet_00.html',
    '/assignments/Particules_sujet_objet_00.html'
  ],
  method: 'GET',
  onError: 'bypass'
};
