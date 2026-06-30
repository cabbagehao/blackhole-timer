#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <dcomp.h>
#include <dxgi1_2.h>
#include <memory>
#include <stdexcept>
#include <string>
#include <wrl/client.h>
#include <windows.h>

using Microsoft::WRL::ComPtr;
using Clock = std::chrono::steady_clock;

namespace {

constexpr wchar_t kWindowClass[] = L"BlackHoleRestNativeD3DWindow";
constexpr int kHotkeyTogglePassthrough = 0x4248;
constexpr int kHotkeyQuit = 0x4251;
constexpr DWORD WDA_EXCLUDEFROMCAPTURE_VALUE = 0x00000011;

template <typename T>
void ThrowIfFailed(HRESULT hr, const T& message) {
  if (FAILED(hr)) {
    throw std::runtime_error(message);
  }
}

struct Vertex {
  float x;
  float y;
  float u;
  float v;
};

struct FrameState {
  float resolution[2];
  float time;
  float intensity;
  float center[2];
  float strength;
  float overlayScale;
  float overlayFeather;
  float padding0[3];
};

class OverlayApp {
 public:
  explicit OverlayApp(HINSTANCE instance) : instance_(instance) {}

  int Run() {
    RegisterWindowClass();
    CreateOverlayWindow();
    InitializeD3D();
    InitializeDuplication();
    ShowWindow(hwnd_, SW_SHOW);
    UpdateWindow(hwnd_);

    MSG msg{};
    auto lastFrame = Clock::now();
    while (running_) {
      while (PeekMessage(&msg, nullptr, 0, 0, PM_REMOVE)) {
        if (msg.message == WM_QUIT) {
          running_ = false;
          break;
        }
        TranslateMessage(&msg);
        DispatchMessage(&msg);
      }

      auto now = Clock::now();
      const float dt = std::min(std::chrono::duration<float>(now - lastFrame).count(), 0.2f);
      lastFrame = now;
      elapsedSeconds_ += dt * speed_;
      if (elapsedSeconds_ >= sessionSeconds_) {
        afterThresholdSeconds_ += dt;
      } else {
        afterThresholdSeconds_ = 0.0f;
      }
      RenderFrame();
    }

    UnregisterHotKey(hwnd_, kHotkeyTogglePassthrough);
    UnregisterHotKey(hwnd_, kHotkeyQuit);
    return 0;
  }

 private:
  void RegisterWindowClass() {
    WNDCLASSEX wc{};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = &OverlayApp::WindowProc;
    wc.hInstance = instance_;
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = nullptr;
    wc.lpszClassName = kWindowClass;
    RegisterClassEx(&wc);
  }

  void CreateOverlayWindow() {
    const int width = GetSystemMetrics(SM_CXSCREEN);
    const int height = GetSystemMetrics(SM_CYSCREEN);
    hwnd_ = CreateWindowEx(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_NOREDIRECTIONBITMAP,
        kWindowClass,
        L"Black Hole Rest Native D3D",
        WS_POPUP,
        0,
        0,
        width,
        height,
        nullptr,
        nullptr,
        instance_,
        this);
    if (!hwnd_) {
      throw std::runtime_error("CreateWindowEx failed");
    }

    SetWindowDisplayAffinity(hwnd_, WDA_EXCLUDEFROMCAPTURE_VALUE);
    passthrough_ = true;
    RegisterHotKey(hwnd_, kHotkeyTogglePassthrough, MOD_CONTROL | MOD_ALT, 'B');
    RegisterHotKey(hwnd_, kHotkeyQuit, MOD_CONTROL | MOD_ALT, 'Q');
  }

  void InitializeD3D() {
    RECT rect{};
    GetClientRect(hwnd_, &rect);
    width_ = std::max<LONG>(1, rect.right - rect.left);
    height_ = std::max<LONG>(1, rect.bottom - rect.top);

    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
#if defined(_DEBUG)
    flags |= D3D11_CREATE_DEVICE_DEBUG;
#endif

    D3D_FEATURE_LEVEL featureLevel{};
    const std::array<D3D_FEATURE_LEVEL, 2> levels = {
        D3D_FEATURE_LEVEL_11_0,
        D3D_FEATURE_LEVEL_10_0,
    };

    ThrowIfFailed(
        D3D11CreateDevice(
            nullptr,
            D3D_DRIVER_TYPE_HARDWARE,
            nullptr,
            flags,
            levels.data(),
            static_cast<UINT>(levels.size()),
            D3D11_SDK_VERSION,
            &device_,
            &featureLevel,
            &context_),
        "D3D11CreateDevice failed");

    CreateCompositionSwapChain();
    CreateRenderTarget();
    CreatePipeline();
  }

  void CreateCompositionSwapChain() {
    ComPtr<IDXGIDevice> dxgiDevice;
    ThrowIfFailed(device_.As(&dxgiDevice), "Query IDXGIDevice failed");

    ComPtr<IDXGIAdapter> adapter;
    ThrowIfFailed(dxgiDevice->GetAdapter(&adapter), "GetAdapter failed");

    ComPtr<IDXGIFactory2> factory;
    ThrowIfFailed(adapter->GetParent(IID_PPV_ARGS(&factory)), "Get DXGI factory failed");

    DXGI_SWAP_CHAIN_DESC1 swapDesc{};
    swapDesc.Width = static_cast<UINT>(width_);
    swapDesc.Height = static_cast<UINT>(height_);
    swapDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    swapDesc.Stereo = FALSE;
    swapDesc.SampleDesc.Count = 1;
    swapDesc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    swapDesc.BufferCount = 2;
    swapDesc.Scaling = DXGI_SCALING_STRETCH;
    swapDesc.SwapEffect = DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL;
    swapDesc.AlphaMode = DXGI_ALPHA_MODE_PREMULTIPLIED;

    ThrowIfFailed(
        factory->CreateSwapChainForComposition(device_.Get(), &swapDesc, nullptr, &swapChain_),
        "CreateSwapChainForComposition failed");

    ThrowIfFailed(DCompositionCreateDevice(dxgiDevice.Get(), IID_PPV_ARGS(&compositionDevice_)), "DCompositionCreateDevice failed");
    ThrowIfFailed(compositionDevice_->CreateTargetForHwnd(hwnd_, TRUE, &compositionTarget_), "CreateTargetForHwnd failed");
    ThrowIfFailed(compositionDevice_->CreateVisual(&compositionVisual_), "CreateVisual failed");
    ThrowIfFailed(compositionVisual_->SetContent(swapChain_.Get()), "SetContent failed");
    ThrowIfFailed(compositionTarget_->SetRoot(compositionVisual_.Get()), "SetRoot failed");
    ThrowIfFailed(compositionDevice_->Commit(), "Composition commit failed");
  }

  void CreateRenderTarget() {
    ComPtr<ID3D11Texture2D> backBuffer;
    ThrowIfFailed(swapChain_->GetBuffer(0, IID_PPV_ARGS(&backBuffer)), "GetBuffer failed");
    ThrowIfFailed(device_->CreateRenderTargetView(backBuffer.Get(), nullptr, &renderTarget_), "CreateRenderTargetView failed");
  }

  void CreatePipeline() {
    ComPtr<ID3DBlob> vertexBlob;
    ComPtr<ID3DBlob> pixelBlob;
    CompileShader(L"BlackHoleOverlay.hlsl", "VSMain", "vs_5_0", &vertexBlob);
    CompileShader(L"BlackHoleOverlay.hlsl", "PSMain", "ps_5_0", &pixelBlob);

    ThrowIfFailed(device_->CreateVertexShader(vertexBlob->GetBufferPointer(), vertexBlob->GetBufferSize(), nullptr, &vertexShader_), "CreateVertexShader failed");
    ThrowIfFailed(device_->CreatePixelShader(pixelBlob->GetBufferPointer(), pixelBlob->GetBufferSize(), nullptr, &pixelShader_), "CreatePixelShader failed");

    const D3D11_INPUT_ELEMENT_DESC layoutDesc[] = {
        {"POSITION", 0, DXGI_FORMAT_R32G32_FLOAT, 0, 0, D3D11_INPUT_PER_VERTEX_DATA, 0},
        {"TEXCOORD", 0, DXGI_FORMAT_R32G32_FLOAT, 0, 8, D3D11_INPUT_PER_VERTEX_DATA, 0},
    };
    ThrowIfFailed(device_->CreateInputLayout(layoutDesc, 2, vertexBlob->GetBufferPointer(), vertexBlob->GetBufferSize(), &inputLayout_), "CreateInputLayout failed");

    const Vertex vertices[] = {
        {-1.0f, -1.0f, 0.0f, 1.0f},
        {-1.0f, 1.0f, 0.0f, 0.0f},
        {1.0f, -1.0f, 1.0f, 1.0f},
        {1.0f, -1.0f, 1.0f, 1.0f},
        {-1.0f, 1.0f, 0.0f, 0.0f},
        {1.0f, 1.0f, 1.0f, 0.0f},
    };

    D3D11_BUFFER_DESC vertexBufferDesc{};
    vertexBufferDesc.ByteWidth = sizeof(vertices);
    vertexBufferDesc.Usage = D3D11_USAGE_IMMUTABLE;
    vertexBufferDesc.BindFlags = D3D11_BIND_VERTEX_BUFFER;
    D3D11_SUBRESOURCE_DATA vertexData{};
    vertexData.pSysMem = vertices;
    ThrowIfFailed(device_->CreateBuffer(&vertexBufferDesc, &vertexData, &vertexBuffer_), "Create vertex buffer failed");

    D3D11_BUFFER_DESC constantDesc{};
    constantDesc.ByteWidth = sizeof(FrameState);
    constantDesc.Usage = D3D11_USAGE_DYNAMIC;
    constantDesc.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
    constantDesc.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    ThrowIfFailed(device_->CreateBuffer(&constantDesc, nullptr, &constantBuffer_), "Create constant buffer failed");

    D3D11_SAMPLER_DESC samplerDesc{};
    samplerDesc.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    samplerDesc.AddressU = D3D11_TEXTURE_ADDRESS_CLAMP;
    samplerDesc.AddressV = D3D11_TEXTURE_ADDRESS_CLAMP;
    samplerDesc.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    samplerDesc.MaxLOD = D3D11_FLOAT32_MAX;
    ThrowIfFailed(device_->CreateSamplerState(&samplerDesc, &sampler_), "Create sampler failed");
  }

  void CompileShader(const wchar_t* fileName, const char* entry, const char* target, ID3DBlob** blob) {
    UINT flags = D3DCOMPILE_ENABLE_STRICTNESS;
#if defined(_DEBUG)
    flags |= D3DCOMPILE_DEBUG | D3DCOMPILE_SKIP_OPTIMIZATION;
#endif
    ComPtr<ID3DBlob> errors;
    HRESULT hr = D3DCompileFromFile(fileName, nullptr, D3D_COMPILE_STANDARD_FILE_INCLUDE, entry, target, flags, 0, blob, &errors);
    if (FAILED(hr)) {
      if (errors) {
        OutputDebugStringA(static_cast<const char*>(errors->GetBufferPointer()));
      }
      throw std::runtime_error("Shader compilation failed");
    }
  }

  void InitializeDuplication() {
    ComPtr<IDXGIDevice> dxgiDevice;
    ThrowIfFailed(device_.As(&dxgiDevice), "Query IDXGIDevice failed");

    ComPtr<IDXGIAdapter> adapter;
    ThrowIfFailed(dxgiDevice->GetAdapter(&adapter), "GetAdapter failed");

    ComPtr<IDXGIOutput> output;
    ThrowIfFailed(adapter->EnumOutputs(0, &output), "EnumOutputs failed");

    DXGI_OUTPUT_DESC outputDesc{};
    output->GetDesc(&outputDesc);
    duplicationLeft_ = outputDesc.DesktopCoordinates.left;
    duplicationTop_ = outputDesc.DesktopCoordinates.top;
    captureWidth_ = std::max<LONG>(1, outputDesc.DesktopCoordinates.right - outputDesc.DesktopCoordinates.left);
    captureHeight_ = std::max<LONG>(1, outputDesc.DesktopCoordinates.bottom - outputDesc.DesktopCoordinates.top);

    ComPtr<IDXGIOutput1> output1;
    ThrowIfFailed(output.As(&output1), "Query IDXGIOutput1 failed");
    ThrowIfFailed(output1->DuplicateOutput(device_.Get(), &duplication_), "DuplicateOutput failed");
  }

  void RenderFrame() {
    EnsureCaptureTexture();
    CaptureLatestFrame();
    UpdateConstants();

    const float clearColor[] = {0.0f, 0.0f, 0.0f, 0.0f};
    context_->ClearRenderTargetView(renderTarget_.Get(), clearColor);

    D3D11_VIEWPORT viewport{};
    viewport.Width = static_cast<float>(width_);
    viewport.Height = static_cast<float>(height_);
    viewport.MinDepth = 0.0f;
    viewport.MaxDepth = 1.0f;
    context_->RSSetViewports(1, &viewport);
    context_->OMSetRenderTargets(1, renderTarget_.GetAddressOf(), nullptr);

    UINT stride = sizeof(Vertex);
    UINT offset = 0;
    context_->IASetInputLayout(inputLayout_.Get());
    context_->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    context_->IASetVertexBuffers(0, 1, vertexBuffer_.GetAddressOf(), &stride, &offset);
    context_->VSSetShader(vertexShader_.Get(), nullptr, 0);
    context_->PSSetShader(pixelShader_.Get(), nullptr, 0);
    context_->PSSetShaderResources(0, 1, captureSrv_.GetAddressOf());
    context_->PSSetSamplers(0, 1, sampler_.GetAddressOf());
    context_->PSSetConstantBuffers(0, 1, constantBuffer_.GetAddressOf());
    context_->Draw(6, 0);

    ID3D11ShaderResourceView* nullSrv[] = {nullptr};
    context_->PSSetShaderResources(0, 1, nullSrv);
    swapChain_->Present(1, 0);
    if (compositionDevice_) {
      compositionDevice_->Commit();
    }
  }

  void EnsureCaptureTexture() {
    if (captureTexture_) {
      return;
    }

    D3D11_TEXTURE2D_DESC desc{};
    desc.Width = width_;
    desc.Height = height_;
    if (captureWidth_ > 0 && captureHeight_ > 0) {
      desc.Width = captureWidth_;
      desc.Height = captureHeight_;
    }
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_DEFAULT;
    desc.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET;
    ThrowIfFailed(device_->CreateTexture2D(&desc, nullptr, &captureTexture_), "Create capture texture failed");
    ThrowIfFailed(device_->CreateShaderResourceView(captureTexture_.Get(), nullptr, &captureSrv_), "Create capture SRV failed");
  }

  void CaptureLatestFrame() {
    if (!duplication_) {
      DrawFallbackCapture();
      return;
    }

    DXGI_OUTDUPL_FRAME_INFO frameInfo{};
    ComPtr<IDXGIResource> desktopResource;
    HRESULT hr = duplication_->AcquireNextFrame(0, &frameInfo, &desktopResource);
    if (hr == DXGI_ERROR_WAIT_TIMEOUT) {
      return;
    }
    if (hr == DXGI_ERROR_ACCESS_LOST) {
      duplication_.Reset();
      InitializeDuplication();
      return;
    }
    if (FAILED(hr)) {
      DrawFallbackCapture();
      return;
    }

    ComPtr<ID3D11Texture2D> desktopTexture;
    if (SUCCEEDED(desktopResource.As(&desktopTexture))) {
      context_->CopyResource(captureTexture_.Get(), desktopTexture.Get());
    }
    duplication_->ReleaseFrame();
  }

  void DrawFallbackCapture() {
    const float pulse = 0.05f + 0.05f * std::sin(elapsedSeconds_ * 0.08f);
    const float clearColor[] = {0.04f + pulse, 0.055f, 0.05f, 1.0f};
    ComPtr<ID3D11RenderTargetView> fallbackRtv;
    if (SUCCEEDED(device_->CreateRenderTargetView(captureTexture_.Get(), nullptr, &fallbackRtv))) {
      context_->ClearRenderTargetView(fallbackRtv.Get(), clearColor);
    }
  }

  void UpdateConstants() {
    const float progress = std::min(elapsedSeconds_ / sessionSeconds_, 1.0f);
    const float shaderTime = progress * 40.0f + afterThresholdSeconds_;

    D3D11_MAPPED_SUBRESOURCE mapped{};
    if (SUCCEEDED(context_->Map(constantBuffer_.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped))) {
      auto* state = static_cast<FrameState*>(mapped.pData);
      state->resolution[0] = static_cast<float>(width_);
      state->resolution[1] = static_cast<float>(height_);
      state->time = shaderTime;
      state->intensity = progress;
      state->center[0] = 0.5f;
      state->center[1] = 0.5f;
      state->strength = 1.0f;
      state->overlayScale = 0.30f;
      state->overlayFeather = 0.045f;
      state->padding0[0] = 0.0f;
      state->padding0[1] = 0.0f;
      state->padding0[2] = 0.0f;
      context_->Unmap(constantBuffer_.Get(), 0);
    }
  }

  void TogglePassthrough() {
    passthrough_ = !passthrough_;
    LONG_PTR style = GetWindowLongPtr(hwnd_, GWL_EXSTYLE);
    if (passthrough_) {
      style |= WS_EX_TRANSPARENT;
    } else {
      style &= ~WS_EX_TRANSPARENT;
    }
    SetWindowLongPtr(hwnd_, GWL_EXSTYLE, style);
  }

  static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
    OverlayApp* app = nullptr;
    if (message == WM_NCCREATE) {
      auto* create = reinterpret_cast<CREATESTRUCT*>(lparam);
      app = static_cast<OverlayApp*>(create->lpCreateParams);
      SetWindowLongPtr(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(app));
      app->hwnd_ = hwnd;
    } else {
      app = reinterpret_cast<OverlayApp*>(GetWindowLongPtr(hwnd, GWLP_USERDATA));
    }

    if (!app) {
      return DefWindowProc(hwnd, message, wparam, lparam);
    }

    switch (message) {
      case WM_HOTKEY:
        if (static_cast<int>(wparam) == kHotkeyTogglePassthrough) {
          app->TogglePassthrough();
          return 0;
        }
        if (static_cast<int>(wparam) == kHotkeyQuit) {
          PostQuitMessage(0);
          return 0;
        }
        break;
      case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
      default:
        break;
    }

    return DefWindowProc(hwnd, message, wparam, lparam);
  }

  HINSTANCE instance_{};
  HWND hwnd_{};
  bool running_{true};
  bool passthrough_{false};
  LONG width_{1};
  LONG height_{1};
  LONG captureWidth_{1};
  LONG captureHeight_{1};
  LONG duplicationLeft_{0};
  LONG duplicationTop_{0};
  float elapsedSeconds_{0.0f};
  float afterThresholdSeconds_{0.0f};
  float speed_{1.0f};
  float sessionSeconds_{25.0f * 60.0f};

  ComPtr<ID3D11Device> device_;
  ComPtr<ID3D11DeviceContext> context_;
  ComPtr<IDXGISwapChain1> swapChain_;
  ComPtr<IDCompositionDevice> compositionDevice_;
  ComPtr<IDCompositionTarget> compositionTarget_;
  ComPtr<IDCompositionVisual> compositionVisual_;
  ComPtr<ID3D11RenderTargetView> renderTarget_;
  ComPtr<ID3D11VertexShader> vertexShader_;
  ComPtr<ID3D11PixelShader> pixelShader_;
  ComPtr<ID3D11InputLayout> inputLayout_;
  ComPtr<ID3D11Buffer> vertexBuffer_;
  ComPtr<ID3D11Buffer> constantBuffer_;
  ComPtr<ID3D11SamplerState> sampler_;
  ComPtr<IDXGIOutputDuplication> duplication_;
  ComPtr<ID3D11Texture2D> captureTexture_;
  ComPtr<ID3D11ShaderResourceView> captureSrv_;
};

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
  try {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    wchar_t modulePath[MAX_PATH]{};
    if (GetModuleFileName(nullptr, modulePath, MAX_PATH) > 0) {
      std::wstring directory(modulePath);
      const auto slash = directory.find_last_of(L"\\/");
      if (slash != std::wstring::npos) {
        directory.resize(slash);
        SetCurrentDirectory(directory.c_str());
      }
    }
    OverlayApp app(instance);
    return app.Run();
  } catch (const std::exception& error) {
    MessageBoxA(nullptr, error.what(), "Black Hole Rest Native D3D", MB_ICONERROR | MB_OK);
    return 1;
  }
}
