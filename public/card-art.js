// Original vector decorations for the contract cards. No external assets or fonts.
// Helpers return decorative SVG only; the surrounding card owns its accessible label.
export function cardEdgeLightning(index = 0) {
  const edge = 'M12 1 33 -2 47 2 59 -2 78 1 104 -1 129 3 147 -2 169 1 188 1 198 12 201 32 198 48 202 63 199 85 201 109 197 126 202 147 198 168 201 192 198 214 202 234 199 254 198 268 188 279 165 281 147 277 128 282 107 279 86 281 66 277 47 282 30 279 12 279 1 268 -2 246 2 226 -2 207 1 186 -1 164 3 144 -2 126 1 105 -2 83 2 62 -1 43 1 24 1 12Z';
  return `<svg class="ssr-edge-lightning" style="--arc-delay:${-index * 137}ms" viewBox="-12 -16 224 312" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="arc-halo" d="${edge}" pathLength="1000"/><path class="arc-core" d="${edge}" pathLength="1000"/><path class="arc-counter" d="${edge}" pathLength="1000"/><path class="arc-sparks" d="m195 48 9-5-3 12 12-2m-11 145 9 5-6 5 11 3M4 224l-10 6 3-12-9 2M58 1l6-8 3 4 5-10"/></svg>`;
}
const FRAME = `
  <path d="M80 9 151 50v78l-71 41L9 128V50Z" opacity=".16"/>
  <path d="M80 18 143 54v70l-63 36-63-36V54Z" opacity=".42"/>
  <path d="m35 42 45-26 45 26M143 78v46l-40 23M57 147l-40-23V78" stroke-width="2" opacity=".6"/>
  <path d="M80 1v11m0 154v11M1 45l11 6m136 80 11 6M1 137l11-6m136-80 11-6" opacity=".5"/>
  <path d="m80 27 3 5-3 5-3-5Zm0 114 3 5-3 5-3-5Z" fill="currentColor" stroke="none" opacity=".7"/>
`;

const MOTIFS = {
  A: `<path d="M80 34 91 51 87 99 80 108 73 99 69 51Z" fill="currentColor" fill-opacity=".08"/>
      <path d="M80 34v74M53 101h54m-54 0 7 7m47-7-7 7"/>
      <path d="M75 107h10v30H75Zm0 8h10m-10 9h10"/>
      <path d="m80 137 8 8-8 10-8-10Z" fill="currentColor" fill-opacity=".14"/>
      <path d="m44 57 5-12 5 12-5 12ZM121 112l3-7 3 7-3 7Z" fill="currentColor" stroke="none" opacity=".5"/>`,
  B: `<path d="M82 39c16 27 36 41 32 62-3 19-18 29-34 29-21 0-38-14-35-35 2-14 12-20 15-35 8 8 9 18 10 24 11-10 18-26 12-45Z"/>
      <path d="M81 80c11 16 19 23 14 35-4 10-20 14-26 4-6-10 1-22 12-39Z" fill="currentColor" fill-opacity=".14"/>
      <path d="m38 78-7-8m85-7 10-10M46 125l-8 7m78-9 8 7M80 31v-8" opacity=".65"/>`,
  D: `<path d="M54 53c6-12 22-17 33-10 12 8 11 23-1 30L64 85c-13 7-18 17-11 28 6 10 25 16 39 8 11-6 16-15 11-24-4-7-12-10-21-7"/>
      <path d="M75 51c6-1 11 3 11 7s-4 7-11 8L60 77c-24 14-27 32-12 45 13 12 33 12 48 3 15-9 19-25 10-38-8-11-23-11-34-2" opacity=".55"/>
      <path d="m55 48-12-2 6 13 10 4m26 36-10-6 1 13ZM110 45l-9 12 11 2 9-9Z" fill="currentColor" fill-opacity=".15"/>
      <path d="m117 73 4 6-4 6-4-6Z" fill="currentColor" stroke="none"/>`,
  T: `<path d="M80 41 115 55v34c0 20-15 34-35 48-20-14-35-28-35-48V55Z" fill="currentColor" fill-opacity=".08"/>
      <path d="m80 52 25 10v26c0 14-10 26-25 37-15-11-25-23-25-37V62Z"/>
      <path d="M80 62v53M64 78h32m-32 0 16-15 16 15M36 60v36m88-36v36" opacity=".75"/>
      <path d="m80 78 10 13-10 15-10-15Z" fill="currentColor" fill-opacity=".2"/>`,
  H: `<path d="M80 42c-6 13-24 28-24 43a24 24 0 0 0 48 0c0-15-18-30-24-43Z" fill="currentColor" fill-opacity=".1"/>
      <path d="M80 67v30M65 82h30M80 111v22M80 126c-28 0-40-18-40-37 13 2 24 10 26 24M80 126c28 0 40-18 40-37-13 2-24 10-26 24"/>
      <path d="m42 59 5 7-5 7-5-7Zm76 0 5 7-5 7-5-7Z" fill="currentColor" stroke="none" opacity=".6"/>`,
  S: `<path d="M42 48c13 4 17 13 16 26l-4 26c-3 16 9 27 26 27s29-11 26-27l-4-26c-1-13 3-22 16-26M52 58h56M58 72h44M63 74v39m11-39v46m12-46v46m11-46v39"/>
      <path d="M64 133h32M71 140h18m-53-45-8-5 8-5m88 0 8 5-8 5" opacity=".65"/>
      <path d="m80 35 5 7-5 7-5-7Z" fill="currentColor" stroke="none"/>`,
  V: `<path d="M49 125 110 57m0 0-4 22m4-22-22 6" stroke-width="3.8"/>
      <path d="M35 92c17 18 46 19 64 6m-65 13c21 20 57 21 80 3" opacity=".78"/>
      <path d="M43 72 61 54m-21 28 8-2"/>
      <path d="m118 91 4 6-4 6-4-6Z" fill="currentColor" stroke="none" opacity=".55"/>`,
};

export function roleCrestArt(template) {
  const motif = MOTIFS[template] || MOTIFS.S;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 178" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${FRAME}<g stroke-width="2.2">${motif}</g></svg>`;
}

export function cardBackArt(rarity = 'R') {
  const ornate = rarity === 'SSR' ? `<path d="m53 84 39 8 15-25m106 0 15 25 39-8M53 376l39-8 15 25m106 0 15-25 39 8"/>
    <path d="m160 95 5 8-5 8-5-8Zm0 254 5 8-5 8-5-8Z" fill="currentColor" stroke="none"/>
    <path d="M108 124 160 93l52 31m-104 212 52 31 52-31" opacity=".35"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 460" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <g opacity=".45"><path d="M22 91V35l13-13h76m98 0h76l13 13v56M22 369v56l13 13h76m98 0h76l13-13v-56"/>
      <path d="M29 128V49l20-20h78m66 0h78l20 20v79M29 332v79l20 20h78m66 0h78l20-20v-79"/>
      <path d="m39 52 13-13 13 13-13 13Zm216 0 13-13 13 13-13 13ZM39 408l13-13 13 13-13 13Zm216 0 13-13 13 13-13 13Z"/>
      <path d="M52 74v22l24 24m192-46v22l-24 24M52 386v-22l24-24m192 46v-22l-24-24"/>
    </g>
    <g opacity=".28"><path d="m160 77 89 153-89 153-89-153Z"/><path d="m160 121 111 109-111 109L49 230Z"/>
      <path d="M160 59v49m0 244v49M37 230h35m176 0h35M89 159l-8-8m158 158-8-8m0-142 8-8M81 309l8-8"/>
    </g>
    <g stroke-width="1.8"><path d="m160 154 48 28v75l-48 41-48-41v-75Z" fill="currentColor" fill-opacity=".025"/>
      <path d="m124 190 36-23 36 23-9 62-27 31-27-31Z"/>
      <path d="m141 180 19 50 19-50m-46 72 27-22 27 22m-27-22v53" opacity=".7"/>
      <path d="m160 192 10 22-10 17-10-17Z" fill="currentColor" fill-opacity=".38"/>
      <path d="m127 152 33-20 33 20m-66 156 33 20 33-20" opacity=".6"/>
    </g>
    <g opacity=".6">${ornate}<path d="m51 218 5 12-5 12-5-12Zm218 0 5 12-5 12-5-12Z" fill="currentColor" stroke="none"/>
      <path d="m112 55 48-15 48 15m-96 350 48 15 48-15M146 57h28m-28 346h28"/>
    </g>
  </svg>`;
}
