

#include "MyLibrary/bindings/MyObject.h"

#include <napi.h>

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    Napi::String name;
    
    name = Napi::String::New(env, "MyObject");
    exports.Set(name, MyObject::GetClass(env));

    return exports;
}

NODE_API_MODULE(myaddon, Init)