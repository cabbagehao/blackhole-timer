Texture2D desktopTexture : register(t0);
SamplerState linearSampler : register(s0);

cbuffer FrameState : register(b0)
{
    float2 resolution;
    float time;
    float intensity;
    float2 center;
    float strength;
    float overlayScale;
    float overlayFeather;
    float3 padding0;
}

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

PSInput VSMain(VSInput input)
{
    PSInput output;
    output.position = float4(input.position, 0.0, 1.0);
    output.uv = input.uv;
    return output;
}

float3 blackbody(float t)
{
    float3 hot = float3(1.0, 0.78, 0.36);
    float3 white = float3(1.0, 0.93, 0.78);
    float3 red = float3(1.0, 0.18, 0.08);
    return lerp(red, lerp(hot, white, saturate(t * 1.2)), saturate(t));
}

float ring(float value, float radius, float width)
{
    return 1.0 - smoothstep(width * 0.55, width, abs(value - radius));
}

float4 PSMain(PSInput input) : SV_TARGET
{
    float2 uv = input.uv;
    float aspect = resolution.x / max(1.0, resolution.y);
    float2 p = uv - center;
    p.x *= aspect;

    float r = max(length(p), 0.0008);
    float angle = atan2(p.y, p.x);
    float level = saturate(intensity);

    float horizon = lerp(0.015, 0.105, level) * strength;
    float lensRadius = horizon * 5.8;
    float lens = smoothstep(lensRadius, horizon * 0.8, r);
    float bend = lens * horizon * horizon * 4.2 / max(r * r, 0.001);

    float swirl = lens * (0.16 + 0.22 * level) * sin(time * 0.28 + r * 24.0);
    float warpedAngle = angle + bend + swirl;
    float warpedRadius = r + bend * 0.11;
    float2 warped = float2(cos(warpedAngle), sin(warpedAngle)) * warpedRadius;
    warped.x /= aspect;
    float2 sampleUv = center + warped;

    sampleUv = clamp(sampleUv, 0.001, 0.999);
    float3 scene = desktopTexture.Sample(linearSampler, sampleUv).rgb;

    float diskTilt = p.y * 1.85 + sin(angle * 2.0 + time * 0.35) * horizon * 0.22;
    float diskDistance = sqrt(p.x * p.x + diskTilt * diskTilt);
    float disk = ring(diskDistance, horizon * 2.55, horizon * 0.44);
    float outerDisk = ring(diskDistance, horizon * 3.65, horizon * 0.72) * 0.45;
    float doppler = 0.55 + 0.45 * sin(angle - time * (0.7 - level * 0.28));
    float3 diskColor = blackbody(0.35 + doppler * 0.85);
    float3 glow = diskColor * (disk * 1.65 + outerDisk) * smoothstep(0.0, 0.08, level);

    float shadow = 1.0 - smoothstep(horizon * 0.82, horizon * 1.08, r);
    float photonRing = ring(r, horizon * 1.22, horizon * 0.16) * (0.8 + level);
    float ca = saturate(lens * 0.35);
    float2 caOffset = normalize(p + 0.0001) * horizon * 0.12 * ca;
    float redChannel = desktopTexture.Sample(linearSampler, clamp(sampleUv + caOffset, 0.001, 0.999)).r;
    float blueChannel = desktopTexture.Sample(linearSampler, clamp(sampleUv - caOffset, 0.001, 0.999)).b;
    scene = lerp(scene, float3(redChannel, scene.g, blueChannel), ca);

    float vignette = smoothstep(lensRadius * 1.25, horizon * 1.35, r) * 0.24 * level;
    float3 color = scene * (1.0 - vignette) + glow + photonRing * float3(1.0, 0.74, 0.36);
    color = lerp(color, float3(0.0, 0.0, 0.0), shadow);

    float overlayRadius = max(lensRadius * overlayScale, horizon * 4.2);
    float feather = max(overlayFeather, horizon * 0.65);
    float overlayAlpha = 1.0 - smoothstep(overlayRadius - feather, overlayRadius, r);

    color = saturate(color);
    return float4(color * overlayAlpha, overlayAlpha);
}
