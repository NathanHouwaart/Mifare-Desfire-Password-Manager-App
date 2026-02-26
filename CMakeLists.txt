cmake_minimum_required(VERSION 3.16)
cmake_policy(SET CMP0091 NEW)
cmake_policy(SET CMP0042 NEW)

project(myaddon VERSION 1.0.0 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

if(MSVC)
    add_compile_options(/MP)
endif()

add_definitions(-DNAPI_VERSION=9)

# 1. External Libraries
set(NFCCPP_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(NFCCPP_BUILD_TESTS OFF CACHE BOOL "" FORCE)
add_subdirectory(native/libs/NfcCpp)

file(GLOB_RECURSE MYLIBRARY_FILES CONFIGURE_DEPENDS
    "${CMAKE_SOURCE_DIR}/native/libs/MyLibrary/src/*.cpp"
    "${CMAKE_SOURCE_DIR}/native/libs/MyLibrary/src/*.c"
)
add_library(MyLibrary STATIC ${MYLIBRARY_FILES})
target_include_directories(MyLibrary PUBLIC "${CMAKE_SOURCE_DIR}/native/libs/MyLibrary/inc")

# 2. Core Logic
file(GLOB_RECURSE CORE_FILES CONFIGURE_DEPENDS
    "${CMAKE_SOURCE_DIR}/native/core/services/*.cc"
    "${CMAKE_SOURCE_DIR}/native/core/services/*.cpp"
)
add_library(core_lib STATIC ${CORE_FILES})
target_include_directories(core_lib PUBLIC "${CMAKE_SOURCE_DIR}/native")
set_target_properties(core_lib PROPERTIES POSITION_INDEPENDENT_CODE ON)

# 3. Hardware Adapters
file(GLOB_RECURSE ADAPTER_FILES CONFIGURE_DEPENDS
    "${CMAKE_SOURCE_DIR}/native/adapters/hardware/*.cc"
    "${CMAKE_SOURCE_DIR}/native/adapters/hardware/*.cpp"
)
add_library(hardware_adapter STATIC ${ADAPTER_FILES})
target_include_directories(hardware_adapter PUBLIC 
    "${CMAKE_SOURCE_DIR}/native"
    "${CMAKE_SOURCE_DIR}/native/libs/NfcCpp/Include"
    "${CMAKE_SOURCE_DIR}/native/libs/NfcCpp/external/etl/include"
)
target_link_libraries(hardware_adapter PUBLIC core_lib NfcCpp)

# 4. Node Addon
file(GLOB_RECURSE BINDING_FILES CONFIGURE_DEPENDS
    "${CMAKE_SOURCE_DIR}/native/bindings/node/*.cc"
    "${CMAKE_SOURCE_DIR}/native/bindings/node/*.cpp"
    "${CMAKE_SOURCE_DIR}/native/RegisterModules.cc"
)
add_library(${PROJECT_NAME} SHARED ${BINDING_FILES} ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_JS_INC}
    ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api
    ${CMAKE_SOURCE_DIR}/native
    ${CMAKE_SOURCE_DIR}/native/libs/MyLibrary/inc
)

target_link_libraries(${PROJECT_NAME}
    PRIVATE
        ${CMAKE_JS_LIB}
        core_lib
        hardware_adapter
        MyLibrary
)

add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy
        $<TARGET_FILE:${PROJECT_NAME}>
        ${CMAKE_SOURCE_DIR}/build/${PROJECT_NAME}.node
)
