Texture2D desktopTexture : register(t0);
SamplerState linearSampler : register(s0);

cbuffer FrameState : register(b0)
{
    float2 resolution;
    float time;
    float intensity;
    float2 hostCenter;
    float strength;
    float overlayScale;
    float overlayFeather;
    float3 padding0;
}

static const float HOLE_RADIUS = 0.0200;
static const float LENS_DEPTH = 13.0000;
static const float STAR_GAIN = 0.0000;
static const float DISK_INNER = 1.8000;
static const float DISK_OUTER = 8.0000;
static const float DISK_INCL = 1.5000;
static const float DISK_ROLL = 0.3500;
static const float DISK_GAIN = 2.2000;
static const float DISK_OPACITY = 0.9000;
static const float DISK_TEMP = 5500.0000;
static const float DOPPLER_MIX = 0.6000;
static const float DISK_BEAM = 2.5000;
static const float DISK_SPEED = 5.0000;
static const float DISK_WIND = 7.0000;
static const float DISK_CONTRAST = 1.6000;
static const float EXPOSURE = 1.4000;
static const float WORK_AREA = 0.3300;
static const float DILATION_MIN = 0.2000;
static const float TOKEN_AREA_MIN = 0.0100;
static const float TOKEN_AREA_MAX = 0.5000;
static const float TOKEN_HOME_X = 0.9600;
static const float TOKEN_HOME_Y = 0.0400;
static const float TOKEN_EASE = 1.0000;
static const float TOKEN_REACH = 1.0000;
static const float TOKEN_CALM = 0.0400;
static const float TOKEN_RUSH = 1.1000;
static const float DEMO_SEC = 42.0000;
static const float DEMO_XFADE = 0.1800;
static const float B_CRIT = 2.5980762;
static const float MAX_SHADOW_RADIUS = 0.0350;
static const float MAX_OVERLAY_RADIUS = 0.1600;
static const int N_STEPS = 48;
static const float PI = 3.1415927;
static const float TAU = 6.2831853;

struct VSInput
{
    float2 position : POSITION;
    float2 uv : TEXCOORD0;
};

struct PSInput
{
    float4 position : SV_POSITION;
    float2 uv : TEXCOORD0;
};

struct DiskLook
{
    float temp;
    float incl;
    float roll;
    float inner;
    float outer;
    float opac;
    float dopp;
    float beam;
    float gain;
    float contr;
    float wind;
    float speed;
    float expo;
    float star;
};

PSInput VSMain(VSInput input)
{
    PSInput output;
    output.position = float4(input.position, 0.0, 1.0);
    output.uv = input.uv;
    return output;
}

DiskLook MakeLook(float temp, float incl, float roll, float inner, float outer, float opac, float dopp, float beam,
                  float gain, float contr, float wind, float speed, float expo, float star)
{
    DiskLook look;
    look.temp = temp;
    look.incl = incl;
    look.roll = roll;
    look.inner = inner;
    look.outer = outer;
    look.opac = opac;
    look.dopp = dopp;
    look.beam = beam;
    look.gain = gain;
    look.contr = contr;
    look.wind = wind;
    look.speed = speed;
    look.expo = expo;
    look.star = star;
    return look;
}

DiskLook DefaultLook()
{
    return MakeLook(DISK_TEMP, DISK_INCL, DISK_ROLL, DISK_INNER, DISK_OUTER, DISK_OPACITY, DOPPLER_MIX,
                    DISK_BEAM, DISK_GAIN, DISK_CONTRAST, DISK_WIND, DISK_SPEED, EXPOSURE, STAR_GAIN);
}

DiskLook TourLook(int index)
{
    if (index == 1) return MakeLook(4500.0, 1.52, 0.10, 2.2, 7.0, 0.85, 0.35, 2.0, 1.4, 0.5, 7.0, 5.0, 1.20, 0.0);
    if (index == 2) return MakeLook(3800.0, 0.55, -0.30, 2.2, 6.0, 0.45, 0.90, 3.5, 1.6, 0.4, 3.0, 2.5, 1.10, 0.0);
    if (index == 3) return MakeLook(6500.0, 0.30, 0.00, 3.0, 10.0, 0.50, 0.80, 2.5, 1.0, 1.1, 7.0, 5.0, 1.00, 0.0);
    if (index == 4) return MakeLook(15000.0, 1.30, 0.35, 3.0, 14.0, 0.35, 1.00, 4.0, 1.2, 1.3, 8.0, 5.0, 0.80, 0.0);
    if (index == 5) return MakeLook(18000.0, 1.05, 0.55, 3.0, 16.0, 0.30, 1.00, 5.0, 1.0, 1.5, 9.0, 6.0, 0.75, 0.0);
    if (index == 6) return MakeLook(5500.0, 1.50, 0.35, 1.8, 8.0, 0.00, 1.00, 2.5, 0.0, 1.6, 7.0, 5.0, 1.00, 0.6);
    return DefaultLook();
}

DiskLook MixLook(DiskLook a, DiskLook b, float f)
{
    DiskLook look;
    look.temp = lerp(a.temp, b.temp, f);
    look.incl = lerp(a.incl, b.incl, f);
    look.roll = lerp(a.roll, b.roll, f);
    look.inner = lerp(a.inner, b.inner, f);
    look.outer = lerp(a.outer, b.outer, f);
    look.opac = lerp(a.opac, b.opac, f);
    look.dopp = lerp(a.dopp, b.dopp, f);
    look.beam = lerp(a.beam, b.beam, f);
    look.gain = lerp(a.gain, b.gain, f);
    look.contr = lerp(a.contr, b.contr, f);
    look.wind = lerp(a.wind, b.wind, f);
    look.speed = lerp(a.speed, b.speed, f);
    look.expo = lerp(a.expo, b.expo, f);
    look.star = lerp(a.star, b.star, f);
    return look;
}

float Smooth01(float edge0, float edge1, float value)
{
    return smoothstep(edge0, edge1, value);
}

DiskLook DemoLook(float t)
{
    float u = frac(t / DEMO_SEC) * 8.0;
    int i = min((int)u, 7);
    float f = Smooth01(1.0 - DEMO_XFADE, 1.0, frac(u));
    return MixLook(TourLook(i), TourLook((i + 1) % 8), f);
}

float Hash21(float2 p)
{
    p = frac(p * float2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return frac(p.x * p.y);
}

float VNoiseWrapY(float2 p, float perY)
{
    float2 i = floor(p);
    float2 f = frac(p);
    f = f * f * (3.0 - 2.0 * f);
    float y0 = fmod(i.y, perY);
    float y1 = fmod(i.y + 1.0, perY);
    float a = lerp(Hash21(float2(i.x, y0)), Hash21(float2(i.x + 1.0, y0)), f.x);
    float b = lerp(Hash21(float2(i.x, y1)), Hash21(float2(i.x + 1.0, y1)), f.x);
    return lerp(a, b, f.y);
}

float2 MirrorUV(float2 u)
{
    return 1.0 - abs(1.0 - fmod(u, 2.0));
}

float2 Rot(float2 v, float a)
{
    float c = cos(a);
    float s = sin(a);
    return float2(c * v.x - s * v.y, s * v.x + c * v.y);
}

float2 Lissa(float t)
{
    return float2(0.75 * sin(t * 0.37) + 0.25 * sin(t * 0.83 + 1.0),
                  0.70 * sin(t * 0.54 + 2.1) + 0.30 * sin(t * 1.07));
}

float3 Blackbody(float temperature)
{
    float t = clamp(temperature, 1500.0, 40000.0) / 100.0;
    float r = t <= 66.0 ? 1.0 : clamp(1.292936 * pow(t - 60.0, -0.1332047), 0.0, 1.0);
    float g = t <= 66.0 ? clamp(0.3900816 * log(t) - 0.6318414, 0.0, 1.0)
                        : clamp(1.1298909 * pow(t - 60.0, -0.0755148), 0.0, 1.0);
    float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.5432068 * log(t - 10.0) - 1.1962540, 0.0, 1.0));
    return float3(r, g, b);
}

float3 Stars(float3 d, float t)
{
    float2 sph = float2(atan2(d.x, -d.z), asin(clamp(d.y, -1.0, 1.0)));
    float2 g = sph * 40.0;
    float2 id = floor(g);
    float h = Hash21(id);
    if (h < 0.92) return float3(0.0, 0.0, 0.0);
    float2 f = frac(g) - 0.5;
    float2 off = (float2(Hash21(id + 17.3), Hash21(id + 31.7)) - 0.5) * 0.7;
    float spark = Smooth01(0.10, 0.0, length(f - off));
    float tw = 0.7 + 0.3 * sin(t * (0.5 + 2.0 * Hash21(id + 5.1)) + 40.0 * h);
    float3 tint = lerp(float3(1.0, 0.82, 0.60), float3(0.75, 0.85, 1.0), Hash21(id + 2.9));
    return tint * spark * tw * ((h - 0.92) / 0.08);
}

float4 Premul(float3 color, float alpha)
{
    alpha = saturate(alpha);
    return float4(saturate(color) * alpha, alpha);
}

float4 PSMain(PSInput input) : SV_TARGET
{
    float2 uv = input.uv;
    float2 res = max(resolution, float2(1.0, 1.0));
    float aspect = res.x / res.y;
    float yUp = 1.0 - uv.y;
    float t = time;

    if (yUp < WORK_AREA) {
        return float4(0.0, 0.0, 0.0, 0.0);
    }

    DiskLook L = DemoLook(t);
    float rin = max(L.inner, 1.6);
    float rout = max(L.outer, rin + 0.5);

    float gFill = pow(clamp(intensity, 0.0, 1.0), TOKEN_EASE);
    float I = lerp(0.10, 1.0, gFill) * strength;
    float rhMin = sqrt(TOKEN_AREA_MIN * aspect / PI);
    float rhMax = sqrt(TOKEN_AREA_MAX * aspect / PI);
    float rhT = lerp(rhMin, rhMax, gFill) * (HOLE_RADIUS / 0.08);
    rhT = min(rhT, MAX_SHADOW_RADIUS);
    float sz = rhT / max(HOLE_RADIUS, 1e-4);

    float marg = min(rhT * lerp(1.45, 0.90, gFill), 0.5 * (1.0 - WORK_AREA - 0.03));
    float xPad = marg / aspect;
    float2 fullLo = float2(min(xPad, 0.5), marg);
    float2 fullHi = float2(max(0.5, 1.0 - xPad), max(marg, 1.0 - (WORK_AREA + 0.03 + marg)));
    float2 corner = clamp(float2(TOKEN_HOME_X, TOKEN_HOME_Y), fullLo, fullHi);
    float reach = lerp(0.06, max(TOKEN_REACH, 0.06), gFill);
    float2 lo = float2(lerp(corner.x, fullLo.x, reach), fullLo.y);
    float2 hi = float2(fullHi.x, lerp(corner.y, fullHi.y, reach));
    float2 room = max((hi - lo) * 0.5, float2(0.0, 0.0));
    float2 wobAmp = min(float2(0.010 + 0.030 * gFill, 0.010 + 0.030 * gFill), max(room * 0.35, float2(0.006, 0.006)));
    float2 ampEff = max(room - wobAmp, float2(0.0, 0.0));
    float2 wander = lerp(Lissa(t * TOKEN_CALM), Lissa(t * TOKEN_RUSH), gFill);
    float2 center = (lo + hi) * 0.5 + wander * ampEff + wobAmp * float2(cos(t * 0.8), sin(t * 1.0));

    float3 original = desktopTexture.Sample(linearSampler, uv).rgb;
    float vis = Smooth01(0.0, 0.10, I);
    if (vis <= 0.0) {
        return float4(0.0, 0.0, 0.0, 0.0);
    }

    float rh = HOLE_RADIUS * sz;
    float dil = lerp(1.0, DILATION_MIN, I);
    float shield = vis * Smooth01(WORK_AREA, WORK_AREA + 0.18, yUp);

    float2 p = (uv - center) * float2(aspect, 1.0);
    float plen = length(p);
    float W = B_CRIT / max(rh, 1e-4);
    float2 pr = Rot(float2(p.x, -p.y), L.roll) * W;
    float bImpact = length(pr);
    float window = exp(-pow(plen / max(7.0 * rh, 1e-5), 2.0));
    float overlayLimit = min(MAX_OVERLAY_RADIUS, max(0.0700, rh * 6.0));
    float overlayMask = 1.0 - Smooth01(overlayLimit - overlayFeather, overlayLimit, plen);
    float overlayAlpha = overlayMask * shield;

    float bmax = rout + 3.0;
    float Z0 = max(14.0, rout + 5.0);

    if (bImpact >= bmax) {
        float u = Z0 * rsqrt(Z0 * Z0 + bImpact * bImpact);
        float defl = (2.0 / (W * W)) / max(plen, 1e-4)
                   * (1.29 * u + 0.07) * max(LENS_DEPTH - 2.14 * u + 0.75, 0.0)
                   * window * shield;
        float2 dir = p / max(plen, 1e-5);
        float3 term;
        float ab = 0.035 * Smooth01(1.0, 2.0, bImpact / bmax);
        [unroll]
        for (int c = 0; c < 3; c++) {
            float k = 1.0 + ((float)c - 1.0) * ab;
            float2 sp = p - dir * defl * k;
            float2 suv = MirrorUV(center + sp / float2(aspect, 1.0));
            term[c] = desktopTexture.Sample(linearSampler, suv)[c];
        }
        float3 d = normalize(float3(-(pr / max(bImpact, 1e-5)) * (2.0 / max(bImpact, 1e-5)), -1.0));
        float3 color = term + Stars(d, t) * L.star * window * shield;
        return Premul(color, overlayAlpha);
    }

    float3 x = float3(pr, Z0);
    float3 v = float3(0.0, 0.0, -1.0);
    float h2 = dot(pr, pr);

    float ci = cos(L.incl);
    float si = sin(L.incl);
    float3 n = float3(0.0, si, ci);
    float3 e2 = float3(0.0, ci, -si);
    float sdir = L.speed < 0.0 ? -1.0 : 1.0;
    float spd = abs(L.speed);

    float3 emitc = float3(0.0, 0.0, 0.0);
    float trans = 1.0;
    bool captured = false;
    float sPrev = dot(x, n);
    float3 xPrev = x;

    [loop]
    for (int i = 0; i < N_STEPS; i++) {
        float r2 = dot(x, x);
        if (r2 < 1.0) { captured = true; break; }
        if (x.z < -Z0 && v.z < 0.0) break;
        if (r2 > 4.0 * Z0 * Z0) break;
        float r = sqrt(r2);
        float dt = clamp(0.16 * r, 0.03, 1.5);
        float3 a = -1.5 * h2 * x / (r2 * r2 * r);
        v += a * (0.5 * dt);
        x += v * dt;
        r2 = dot(x, x);
        r = sqrt(r2);
        a = -1.5 * h2 * x / (r2 * r2 * r);
        v += a * (0.5 * dt);

        float s = dot(x, n);
        if (s * sPrev < 0.0 && trans > 0.02) {
            float tc = sPrev / (sPrev - s);
            float3 xc = lerp(xPrev, x, tc);
            float rc = length(xc);
            if (rc > rin && rc < rout) {
                float band = Smooth01(rin, rin * 1.25, rc) * (1.0 - Smooth01(rout * 0.70, rout, rc));
                float phi = atan2(dot(xc, e2), xc.x);
                float turns = phi / TAU;
                float kep = pow(rin / rc, 1.5);
                float gloc = sqrt(max(1.0 - 1.5 / rc, 0.02));
                float swirl = rc * L.wind * 0.12 - t * kep * spd * gloc * dil * sdir;
                float streaks = VNoiseWrapY(float2(rc * 2.8, turns * 19.0 + swirl * 3.0), 19.0) * 0.65 +
                                VNoiseWrapY(float2(rc * 1.0, turns * 9.0 + swirl * 1.5 + 7.0), 9.0) * 0.35;
                streaks = 0.35 + L.contr * streaks * streaks;

                float3 gasdir = normalize(cross(n, xc)) * sdir;
                float beta = clamp(rsqrt(max(2.0 * (rc - 1.0), 0.2)), 0.0, 0.99);
                float doppler = gloc / max(1.0 + beta * dot(gasdir, normalize(v)), 0.05);
                doppler = lerp(1.0, doppler, L.dopp);

                float xpr = max(1.0 - sqrt(rin / rc), 0.0);
                float tprof = pow(rin / rc, 0.75) * pow(xpr, 0.25) / 0.488;
                float3 cbb = Blackbody(L.temp * tprof * doppler);
                float boost = pow(doppler, L.beam);

                float density = band * streaks;
                emitc += trans * cbb * (L.gain * 2.2 * density * tprof * tprof * boost);
                trans *= 1.0 - clamp(L.opac * density, 0.0, 1.0);
            }
        }
        sPrev = s;
        xPrev = x;
    }

    if (!captured && dot(x, x) < 4.0) captured = true;

    float3 bg = float3(0.0, 0.0, 0.0);
    if (!captured) {
        float3 d = normalize(v);
        bg += Stars(d, t) * L.star * window * shield;
        if (d.z < -0.05) {
            float tpl = (-LENS_DEPTH - x.z) / d.z;
            float3 hp = x + d * tpl;
            float2 q = Rot(hp.xy, -L.roll) / W;
            float2 sp = float2(q.x, -q.y);
            float2 suv = MirrorUV(center + (p + (sp - p) * window * shield) / float2(aspect, 1.0));
            float toward = Smooth01(0.05, 0.35, -d.z);
            bg += desktopTexture.Sample(linearSampler, suv).rgb * toward;
        }
    }

    float3 color = bg * trans + (float3(1.0, 1.0, 1.0) - exp(-emitc * L.expo));
    return Premul(color, overlayAlpha);
}
