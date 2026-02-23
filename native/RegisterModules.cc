

#include "bindings/node/MyLibraryBinding.h"
#include "bindings/node/NfcCppBinding.h"

#include <napi.h>

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    Napi::String name;
    
    name = Napi::String::New(env, "MyLibraryBinding");
    exports.Set(name, MyLibraryBinding::GetClass(env));

    Napi::String nfcName = Napi::String::New(env, "NfcCppBinding");
    exports.Set(nfcName, NfcCppBinding::GetClass(env));

    return exports;
}

NODE_API_MODULE(myaddon, Init)