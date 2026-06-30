cmake_minimum_required(VERSION 3.22)

project(BlackHoleRestNativeD3D LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(BlackHoleRestNativeD3D WIN32
  src/main.cpp
)

target_link_libraries(BlackHoleRestNativeD3D
  PRIVATE
    d3d11
    dxgi
    d3dcompiler
    user32
    gdi32
)

target_compile_definitions(BlackHoleRestNativeD3D PRIVATE
  UNICODE
  _UNICODE
  WIN32_LEAN_AND_MEAN
  NOMINMAX
)

add_custom_command(TARGET BlackHoleRestNativeD3D POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    ${CMAKE_CURRENT_SOURCE_DIR}/src/BlackHoleOverlay.hlsl
    $<TARGET_FILE_DIR:BlackHoleRestNativeD3D>/BlackHoleOverlay.hlsl
)
