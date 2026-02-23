#include "NfcCppBinding.h"
#include "../../adapters/hardware/Pn532Adapter.h"

using namespace Napi;

NfcCppBinding::NfcCppBinding(const Napi::CallbackInfo& info)
    : ObjectWrap(info)
{
    auto adapter = std::make_unique<adapters::hardware::Pn532Adapter>();
    _service = std::make_shared<core::services::NfcService>(std::move(adapter));
}

NfcCppBinding::~NfcCppBinding() {
    if (_hasLogCallback) {
        _service->setLogCallback(nullptr); // clear handler before TSFN teardown
        _logTsfn.Release();
    }
}

class ConnectWorker : public Napi::AsyncWorker {
public:
    ConnectWorker(Napi::Env& env, Napi::Promise::Deferred deferred, std::shared_ptr<core::services::NfcService> service, std::string port)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)), _port(port) {}

    void Execute() override {
        _result = _service->connect(_port);
    }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<std::string>(_result)) {
            _deferred.Resolve(Napi::String::New(env, std::get<std::string>(_result)));
        } else {
            auto error = std::get<core::ports::NfcError>(_result);
            _deferred.Reject(Napi::Error::New(env, error.message).Value());
        }
    }

    void OnError(const Napi::Error& e) override {
        Napi::Env env = Env();
        _deferred.Reject(e.Value());
    }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    std::string _port;
    core::ports::Result<std::string> _result;
};

class DisconnectWorker : public Napi::AsyncWorker {
public:
    DisconnectWorker(Napi::Env& env, Napi::Promise::Deferred deferred, std::shared_ptr<core::services::NfcService> service)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)) {}

    void Execute() override {
        _result = _service->disconnect();
    }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<bool>(_result)) {
            _deferred.Resolve(Napi::Boolean::New(env, std::get<bool>(_result)));
        } else {
            auto error = std::get<core::ports::NfcError>(_result);
            _deferred.Reject(Napi::Error::New(env, error.message).Value());
        }
    }

    void OnError(const Napi::Error& e) override {
        Napi::Env env = Env();
        _deferred.Reject(e.Value());
    }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    core::ports::Result<bool> _result;
};

Napi::Value NfcCppBinding::Connect(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString())
    {
        Napi::TypeError::New(env, "You need to provide a COM port string!")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string port = info[0].As<Napi::String>().Utf8Value();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    ConnectWorker* worker = new ConnectWorker(env, deferred, _service, port);
    worker->Queue();

    return deferred.Promise();
}

Napi::Value NfcCppBinding::Disconnect(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    DisconnectWorker* worker = new DisconnectWorker(env, deferred, _service);
    worker->Queue();

    return deferred.Promise();
}

Napi::Value NfcCppBinding::SetLogCallback(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected a function").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Release previous TSFN if any
    if (_hasLogCallback) {
        _service->setLogCallback(nullptr);
        _logTsfn.Release();
        _hasLogCallback = false;
    }

    _logTsfn = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "NfcLogCallback",
        128, // bounded queue — log entries are dropped on overflow
        1    // initial thread count
    );
    _hasLogCallback = true;

    // Capture TSFN by value — avoids raw 'this' dangling pointer entirely
    auto tsfn = _logTsfn;
    _service->setLogCallback([tsfn](const char* level, const char* message) mutable {
        std::string lvl(level);
        std::string msg(message);
        auto status = tsfn.NonBlockingCall([lvl, msg](Napi::Env env, Napi::Function jsCallback) {
            jsCallback.Call({
                Napi::String::New(env, lvl),
                Napi::String::New(env, msg)
            });
        });
        // napi_closing  → TSFN is shutting down, safe to drop
        // napi_queue_full → bounded overflow, safe to drop
        (void)status;
    });

    return env.Undefined();
}

Napi::Function NfcCppBinding::GetClass(Napi::Env env)
{
    return DefineClass(
        env,
        "NfcCppBinding",
        {
            InstanceMethod("connect", &NfcCppBinding::Connect),
            InstanceMethod("disconnect", &NfcCppBinding::Disconnect),
            InstanceMethod("setLogCallback", &NfcCppBinding::SetLogCallback)
        }
    );
}
