"""Generates the watercolor app icon: icon.svg (rounded, transparent corners) and
icon-bleed.svg (full-bleed, for maskable/iOS). Used by build_icons.sh: gen.py <output dir>."""
import sys
out = sys.argv[1]

DEFS = '''
<defs>
  <!-- A wet-edged wash: wobbly outline, soft bleed, darker pigment pooled at the rim, faint granulation. -->
  <filter id="wash" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="7" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="15" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="1.1" result="b"/>
    <feMorphology in="b" operator="erode" radius="3.2" result="inner"/>
    <feComposite in="b" in2="inner" operator="out" result="rim"/>
    <feColorMatrix in="rim" type="matrix" values="0.55 0 0 0 0  0 0.6 0 0 0  0 0 0.6 0 0  0 0 0 0.62 0" result="rimDark"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="g"/>
    <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.8 1.28" result="gAlpha"/>
    <feComposite in="b" in2="gAlpha" operator="in" result="grainy"/>
    <feMerge><feMergeNode in="grainy"/><feMergeNode in="rimDark"/></feMerge>
  </filter>
  <!-- A looser, lighter wash for background clouds and splashes. -->
  <filter id="cloud" x="-30%" y="-30%" width="160%" height="160%">
    <feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves="3" seed="11" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="38" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="9"/>
  </filter>
  <filter id="drop" x="-30%" y="-30%" width="160%" height="160%">
    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="5" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="1.4"/>
  </filter>
  <!-- Cold-press paper grain over everything. -->
  <filter id="paper" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="4" seed="2" result="t"/>
    <feColorMatrix in="t" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.3  0 0 0 0 0.22  0 0 0 -0.9 0.5"/>
  </filter>
  <filter id="deckle" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="9" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <radialGradient id="glow" cx="50%" cy="46%" r="55%">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.9"/>
    <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="frame"><rect x="14" y="14" width="484" height="484" rx="118"/></clipPath>
</defs>
'''

PAINTING = '''
  <!-- paper -->
  <rect width="512" height="512" fill="#F8F4E9"/>
  <rect width="512" height="512" fill="url(#glow)"/>
  <!-- background clouds -->
  <g filter="url(#cloud)">
    <ellipse cx="120" cy="120" rx="130" ry="100" fill="#8FD3B6" opacity="0.38"/>
    <ellipse cx="420" cy="150" rx="110" ry="90" fill="#FFC7A8" opacity="0.42"/>
    <ellipse cx="400" cy="420" rx="140" ry="95" fill="#9ED8D0" opacity="0.40"/>
    <ellipse cx="90" cy="410" rx="110" ry="85" fill="#F7DE9A" opacity="0.40"/>
  </g>
  <!-- splashes -->
  <g filter="url(#drop)">
    <circle cx="84" cy="236" r="9" fill="#F26B3A" opacity="0.55"/>
    <circle cx="70" cy="270" r="5" fill="#F26B3A" opacity="0.45"/>
    <circle cx="436" cy="262" r="8" fill="#17A78F" opacity="0.5"/>
    <circle cx="452" cy="300" r="4.5" fill="#17A78F" opacity="0.45"/>
    <circle cx="402" cy="78" r="7" fill="#F2B544" opacity="0.6"/>
    <circle cx="116" cy="84" r="5" fill="#2E9E6B" opacity="0.5"/>
  </g>

  <!-- tote straps, behind everything on top -->
  <g fill="none" stroke-linecap="round" filter="url(#wash)">
    <path d="M156 270 C100 120 412 120 356 270" stroke="#0F6F5A" stroke-width="13" opacity="0.78"/>
    <path d="M156 270 C104 134 408 134 356 270" stroke="#7BD4BE" stroke-width="4" opacity="0.5"/>
  </g>
  <!-- leafy greens behind the produce -->
  <g filter="url(#wash)">
    <path d="M262 250 C226 214 200 160 214 98 C256 120 284 170 282 250 Z" fill="#3BA46E" opacity="0.82"/>
    <path d="M250 250 C240 200 244 150 262 104 C284 150 286 206 270 250 Z" fill="#17734B" opacity="0.5"/>
    <path d="M272 250 C300 206 326 160 352 108 C392 142 380 206 322 250 Z" fill="#59B684" opacity="0.8"/>
    <path d="M290 250 C312 214 330 178 346 136 C366 168 352 214 316 250 Z" fill="#17734B" opacity="0.38"/>
  </g>
  <g fill="none" stroke="#0F5537" stroke-width="3" stroke-linecap="round" opacity="0.5" filter="url(#drop)">
    <path d="M262 246 C250 206 242 160 238 120"/>
    <path d="M286 246 C312 204 334 160 350 120"/>
  </g>

  <!-- tomato -->
  <g filter="url(#wash)">
    <circle cx="204" cy="228" r="60" fill="#F26B3A" opacity="0.88"/>
    <circle cx="190" cy="244" r="40" fill="#D9421F" opacity="0.38"/>
    <ellipse cx="184" cy="204" rx="17" ry="11" fill="#FFD2B8" opacity="0.78" transform="rotate(-28 184 204)"/>
  </g>
  <g filter="url(#wash)">
    <path d="M204 172 L190 154 L204 160 L206 140 L216 158 L232 150 L220 172 Z" fill="#17734B" opacity="0.88"/>
  </g>
  <!-- lemon -->
  <g filter="url(#wash)">
    <ellipse cx="318" cy="222" rx="54" ry="48" fill="#F5BE3F" opacity="0.9" transform="rotate(-14 318 222)"/>
    <ellipse cx="330" cy="240" rx="34" ry="28" fill="#E0962A" opacity="0.34" transform="rotate(-14 330 240)"/>
    <ellipse cx="304" cy="206" rx="14" ry="9" fill="#FFF3C4" opacity="0.8" transform="rotate(-26 304 206)"/>
  </g>

  <!-- the tote -->
  <g filter="url(#wash)">
    <path d="M142 262 L370 262 L388 424 Q390 446 368 446 L144 446 Q122 446 124 424 Z" fill="#1AA383" opacity="0.9"/>
    <path d="M124 424 Q122 446 144 446 L250 446 L214 262 L142 262 Z" fill="#0F6F5A" opacity="0.34"/>
    <path d="M276 262 L370 262 L388 424 Q390 446 368 446 L300 446 Z" fill="#7BD4BE" opacity="0.4"/>
  </g>
  <!-- fold line and rim -->
  <g fill="none" stroke-linecap="round" filter="url(#drop)">
    <path d="M142 276 Q256 296 370 276" stroke="#0B5A48" stroke-width="5" opacity="0.5"/>
    <path d="M140 270 Q256 288 372 270" stroke="#FFFFFF" stroke-width="3.5" opacity="0.55"/>
  </g>
  <!-- a hand-lettered price tag tied on -->
  <g filter="url(#wash)">
    <path d="M214 330 L298 330 Q312 330 312 344 L312 392 Q312 406 298 406 L214 406 Q200 406 200 392 L200 344 Q200 330 214 330 Z" fill="#FFF6E2" opacity="0.96"/>
    <path d="M200 392 Q200 406 214 406 L298 406 Q312 406 312 392 L312 384 L200 388 Z" fill="#F2B544" opacity="0.28"/>
  </g>
  <g filter="url(#drop)">
    <circle cx="256" cy="344" r="5" fill="#0F6F5A" opacity="0.65"/>
    <path d="M236 378 L248 392 L278 358" fill="none" stroke="#F26B3A" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>
  </g>

  <!-- paper grain -->
  <rect width="512" height="512" filter="url(#paper)" opacity="0.32"/>
'''

def svg(bleed):
    if bleed:
        # Full-bleed for maskable/iOS: the art is scaled in so it stays inside the 80% safe zone.
        body = ('<rect width="512" height="512" fill="#F8F4E9"/>'
                f'<g transform="translate(256 256) scale(0.84) translate(-256 -256)">{PAINTING}</g>')
    else:
        body = f'<g clip-path="url(#frame)" filter="url(#deckle)">{PAINTING}</g>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Grocery Tracker">
<title>Grocery Tracker</title>{DEFS}
{body}
</svg>
'''

open(f'{out}/icon.svg', 'w').write(svg(False))
open(f'{out}/icon-bleed.svg', 'w').write(svg(True))
print('ok')
