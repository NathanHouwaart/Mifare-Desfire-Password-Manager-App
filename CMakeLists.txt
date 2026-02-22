cmake_minimum_required(VERSION 3.16)
cmake_policy(SET CMP0091 NEW)
cmake_policy(SET CMP0042 NEW)

project(myaddon VERSION 1.0.0 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)

include_directories(${CMAKE_JS_INC})
include_directories(${CMAKE_SOURCE_DIR}/node_modules/node-addon-api)

add_definitions(-DNAPI_VERSION=9)
include_directories(${CMAKE_JS_INC} "native" "native/MyLibrary/inc")

file(GLOB_RECURSE ALL_ADDON_FILES
    "${CMAKE_SOURCE_DIR}/native/*.c"
    "${CMAKE_SOURCE_DIR}/native/*.cpp"
    "${CMAKE_SOURCE_DIR}/native/*.cc"
    "${CMAKE_SOURCE_DIR}/native/*.cxx"
    "${CMAKE_SOURCE_DIR}/native/*.h"
    "${CMAKE_SOURCE_DIR}/native/*.hpp"
    "${CMAKE_SOURCE_DIR}/native/*.hh"
)

# Filter out tests and example programs that may define their own main()
set(SOURCE_FILES)
foreach(_f ${ALL_ADDON_FILES})
    get_filename_component(_name "${_f}" NAME)
    if(_name MATCHES "^test\\.(c|cpp)$")
        continue()
    endif()

    list(APPEND SOURCE_FILES ${_f})
endforeach()

add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_JS_INC}
    ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api
    ${CMAKE_SOURCE_DIR}/native
    ${CMAKE_SOURCE_DIR}/native/MyLibrary/inc
)

target_link_libraries(${PROJECT_NAME}
    PRIVATE
        ${CMAKE_JS_LIB}
)

add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy
        $<TARGET_FILE:${PROJECT_NAME}>
        ${CMAKE_SOURCE_DIR}/build/${PROJECT_NAME}.node
)
