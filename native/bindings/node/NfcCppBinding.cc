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
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
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
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
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

// ─── GetFirmwareVersion ───────────────────────────────────────────────────────

class GetFirmwareVersionWorker : public Napi::AsyncWorker {
public:
    GetFirmwareVersionWorker(Napi::Env& env, Napi::Promise::Deferred deferred,
                             std::shared_ptr<core::services::NfcService> service)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)) {}

    void Execute() override {
        _result = _service->getFirmwareVersion();
    }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<std::string>(_result)) {
            _deferred.Resolve(Napi::String::New(env, std::get<std::string>(_result)));
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
        }
    }

    void OnError(const Napi::Error& e) override { _deferred.Reject(e.Value()); }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    core::ports::Result<std::string> _result;
};

Napi::Value NfcCppBinding::GetFirmwareVersion(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    GetFirmwareVersionWorker* worker = new GetFirmwareVersionWorker(env, deferred, _service);
    worker->Queue();
    return deferred.Promise();
}

// ─── RunSelfTests ─────────────────────────────────────────────────────────────

// Converts a SelfTestResult outcome to its JS string representation.
static std::string outcomeToString(core::ports::TestOutcome outcome) {
    switch (outcome) {
        case core::ports::TestOutcome::Success: return "success";
        case core::ports::TestOutcome::Failed:  return "failed";
        case core::ports::TestOutcome::Skipped: return "skipped";
    }
    return "failed";
}

class RunSelfTestsWorker : public Napi::AsyncProgressWorker<core::ports::SelfTestResult> {
public:
    // onProgress is optional — null TSFN means no streaming (caller didn't pass a callback)
    RunSelfTestsWorker(Napi::Env& env, Napi::Promise::Deferred deferred,
                       std::shared_ptr<core::services::NfcService> service,
                       Napi::ThreadSafeFunction progressTsfn)
        : Napi::AsyncProgressWorker<core::ports::SelfTestResult>(env),
          _deferred(deferred), _service(std::move(service)),
          _progressTsfn(std::move(progressTsfn)) {}

    void Execute(const ExecutionProgress& progress) override {
        // Wire the C++ progress callback to AsyncProgressWorker::Send()
        // so each completed test is marshalled to OnProgress() on the JS thread.
        _result = _service->runSelfTests([&progress](const core::ports::SelfTestResult& r) {
            progress.Send(&r, 1);
        });
    }

    void OnProgress(const core::ports::SelfTestResult* data, size_t count) override {
        // Already on the JS main thread — call the TSFN synchronously.
        Napi::HandleScope scope(Env());
        for (size_t i = 0; i < count; ++i) {
            const auto& r = data[i];
            std::string name   = r.name;
            std::string status = outcomeToString(r.outcome);
            std::string detail = r.detail;
            _progressTsfn.NonBlockingCall([name, status, detail](Napi::Env env, Napi::Function fn) {
                Napi::Object row = Napi::Object::New(env);
                row.Set("name",   Napi::String::New(env, name));
                row.Set("status", Napi::String::New(env, status));
                row.Set("detail", Napi::String::New(env, detail));
                fn.Call({row});
            });
        }
    }

    void OnOK() override {
        _progressTsfn.Release();
        Napi::Env env = Env();
        if (std::holds_alternative<core::ports::SelfTestReport>(_result)) {
            const auto& report = std::get<core::ports::SelfTestReport>(_result);
            Napi::Object obj = Napi::Object::New(env);
            Napi::Array  arr = Napi::Array::New(env, 5);
            for (uint32_t i = 0; i < 5; ++i) {
                const auto& r    = report.results[i];
                Napi::Object row = Napi::Object::New(env);
                row.Set("name",   Napi::String::New(env, r.name));
                row.Set("status", Napi::String::New(env, outcomeToString(r.outcome)));
                row.Set("detail", Napi::String::New(env, r.detail));
                arr.Set(i, row);
            }
            obj.Set("results", arr);
            _deferred.Resolve(obj);
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
        }
    }

    void OnError(const Napi::Error& e) override {
        _progressTsfn.Release();
        _deferred.Reject(e.Value());
    }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    core::ports::Result<core::ports::SelfTestReport> _result;
    Napi::ThreadSafeFunction _progressTsfn;
};

Napi::Value NfcCppBinding::RunSelfTests(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    // info[0] is an optional JS progress callback (onResult: (row) => void)
    Napi::Function progressFn = (info.Length() >= 1 && info[0].IsFunction())
        ? info[0].As<Napi::Function>()
        : Napi::Function::New(env, [](const Napi::CallbackInfo&){});

    auto tsfn = Napi::ThreadSafeFunction::New(env, progressFn, "SelfTestProgress", 32, 1);
    RunSelfTestsWorker* worker = new RunSelfTestsWorker(env, deferred, _service, std::move(tsfn));
    worker->Queue();
    return deferred.Promise();
}

// ─── GetCardVersion ───────────────────────────────────────────────────────────

class GetCardVersionWorker : public Napi::AsyncWorker {
public:
    GetCardVersionWorker(Napi::Env& env, Napi::Promise::Deferred deferred,
                         std::shared_ptr<core::services::NfcService> service)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)) {}

    void Execute() override {
        _result = _service->getCardVersion();
    }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<core::ports::CardVersionInfo>(_result)) {
            const auto& info = std::get<core::ports::CardVersionInfo>(_result);
            Napi::Object obj = Napi::Object::New(env);
            obj.Set("hwVersion",     Napi::String::New(env, info.hwVersion));
            obj.Set("swVersion",     Napi::String::New(env, info.swVersion));
            obj.Set("uidHex",        Napi::String::New(env, info.uidHex));
            obj.Set("storage",       Napi::String::New(env, info.storage));
            obj.Set("rawVersionHex", Napi::String::New(env, info.rawVersionHex));
            _deferred.Resolve(obj);
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
        }
    }

    void OnError(const Napi::Error& e) override { _deferred.Reject(e.Value()); }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    core::ports::Result<core::ports::CardVersionInfo> _result;
};

Napi::Value NfcCppBinding::GetCardVersion(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    GetCardVersionWorker* worker = new GetCardVersionWorker(env, deferred, _service);
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
            InstanceMethod("connect",            &NfcCppBinding::Connect),
            InstanceMethod("disconnect",         &NfcCppBinding::Disconnect),
            InstanceMethod("setLogCallback",     &NfcCppBinding::SetLogCallback),
            InstanceMethod("getFirmwareVersion", &NfcCppBinding::GetFirmwareVersion),
            InstanceMethod("runSelfTests",       &NfcCppBinding::RunSelfTests),
            InstanceMethod("getCardVersion",     &NfcCppBinding::GetCardVersion),
        }
    );
}
