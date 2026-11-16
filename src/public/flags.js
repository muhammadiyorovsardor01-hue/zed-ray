/**
 * Crisp SVG Country Flags for Windows (where emoji flags don't render in color)
 */
const FLAGS = {
  'HK': `<svg width="24" height="18" viewBox="0 0 640 480" class="svg-flag"><path fill="#de2910" d="M0 0h640v480H0z"/><g fill="#fff"><path d="M309.2 245.5c-4.9-1.9-8.4-5.8-10.4-10.4-3.7-8.3-2.3-17.6 3.6-24.8 5.4-6.6 13.5-10.1 22-9.6 13.9.8 24.7 12 24.5 25.9-.1 8.8-4.6 16.7-12 21.2 6.6-4.5 11.2-11.8 12.5-20.1 1.7-10.7-3.1-21.3-12-27.4-8.8-6.1-20.2-6.5-29.4-1.2-13.6 7.9-19 25.1-12.4 39.4 3.7 8 10.3 14 18.6 17zm-40.8-31.2c-5.2.7-10.2-.4-14.4-3.1-7.7-5-11.6-13.8-10.1-23 1.3-8.3 7-15.1 14.8-18.4 12.8-5.3 27.4.2 33.3 12.7 3.8 7.9 3.3 17-1.1 24.5 3.9-6.9 4.3-15.2 1-22.6-4.3-9.9-13.8-16.3-24.5-16.7-10.7-.4-20.7 5.2-25.7 14.7-7.4 14-3.1 31.4 10 40 7.4 4.8 16.2 6.4 24.7 4.5zm19.9 50.1c-1.5 5.1-5.1 8.9-9.5 11.2-8.1 4.2-17.5 3.1-25-2.5-6.8-5.1-10.8-12.9-10.9-21.4-.1-13.9 10.5-25.4 24.3-26.1 8.8-.4 17 3.4 22 10.4-4.9-6.3-12.4-10-20.7-10.1-10.8-.1-20.8 5.6-26 14.9-5.1 9.4-4.5 20.8 1.5 29.4 9 12.8 26.6 16.8 40.5 9.1 7.8-4.3 13.1-11.4 15.3-20zm50-13.4c3.4 4 5 9.2 4.6 14.5-.8 9.1-6.6 16.8-15 20.2-7.6 3.1-16.3 1.6-22.9-3.8-10.7-8.9-13.7-23.9-6.9-36.2 4.3-7.7 12-12.8 20.7-13.8-7.9.8-15 5-19.4 11.7-5.9 8.9-6.4 20.4-1.3 29.8 5.1 9.4 14.7 15 25.1 14.5 15.4-.8 27.6-13.7 27.7-29.1.1-8.9-4-17-10.9-22.4zm-9.3-46.7c5.1 1.2 9.5 4.3 12.2 8.7 5.1 8 5.4 17.5.8 25.1-4.2 6.9-11.7 11.1-20 11.4-13.8.4-25.3-9.7-26.7-23.5-.9-8.8 2.5-17.1 8.9-22.7-5.8 5.5-9 13.1-8.3 21.4.9 10.8 7.3 20.3 17 24.6 9.7 4.4 21 .9 28.7-6.5 11.5-10.9 13.4-28.7 4.1-41.9-5.4-7.6-13.1-12.3-22-13.2z"/></g></svg>`,
  'EU': `<svg width="24" height="18" viewBox="0 0 640 480" class="svg-flag"><path fill="#003399" d="M0 0h640v480H0z"/><g fill="#ffcc00"><circle cx="320" cy="80" r="18"/><circle cx="320" cy="400" r="18"/><circle cx="160" cy="240" r="18"/><circle cx="480" cy="240" r="18"/><circle cx="207" cy="127" r="18"/><circle cx="433" cy="127" r="18"/><circle cx="207" cy="353" r="18"/><circle cx="433" cy="353" r="18"/><circle cx="137" cy="180" r="18"/><circle cx="503" cy="180" r="18"/><circle cx="137" cy="300" r="18"/><circle cx="503" cy="300" r="18"/></g></svg>`,
  'US': `<svg width="24" height="18" viewBox="0 0 640 480" class="svg-flag"><path fill="#bd3d44" d="M0 0h640v480H0z"/><path stroke="#fff" stroke-width="37" d="M0 55h640M0 129h640M0 203h640M0 277h640M0 351h640M0 425h640"/><path fill="#192f5d" d="M0 0h260v258H0z"/></svg>`,
  'DE': `<svg width="24" height="18" viewBox="0 0 640 480" class="svg-flag"><path fill="#000" d="M0 0h640v160H0z"/><path fill="#d00" d="M0 160h640v160H0z"/><path fill="#ffce00" d="M0 320h640v160H0z"/></svg>`,
  'SG': `<svg width="24" height="18" viewBox="0 0 640 480" class="svg-flag"><path fill="#ed2939" d="M0 0h640v240H0z"/><path fill="#fff" d="M0 240h640v240H0z"/></svg>`,
  'JP': `<svg width="24" height="18" viewBox="0 0 640 480" class="svg-flag"><path fill="#fff" d="M0 0h640v480H0z"/><circle cx="320" cy="240" r="144" fill="#bc002d"/></svg>`,
  'GLOBAL': `<svg width="24" height="18" viewBox="0 0 24 24" fill="none" stroke="#00f2fe" stroke-width="2" class="svg-flag"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`
};

function getCountryFlagSvg(countryCodeOrName) {
  const code = (countryCodeOrName || '').toUpperCase();
  if (code.includes('HK') || code.includes('HONG')) return FLAGS.HK;
  if (code.includes('EU') || code.includes('EUROPE')) return FLAGS.EU;
  if (code.includes('US') || code.includes('UNITED') || code.includes('AMERICA')) return FLAGS.US;
  if (code.includes('DE') || code.includes('GERMANY')) return FLAGS.DE;
  if (code.includes('SG') || code.includes('SINGAPORE')) return FLAGS.SG;
  if (code.includes('JP') || code.includes('JAPAN')) return FLAGS.JP;
  return FLAGS.GLOBAL;
}
