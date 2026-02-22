#include "MyLibrary.h"
#include <iostream>

MyLibrary::MyLibrary(const std::string& name) : _name(name) {}

std::string MyLibrary::greet(const std::string& guestName) const {
    std::cout << "Hello " << guestName << "\n";
    std::cout << "My name is " << _name << "\n";
    return "Hello " + guestName + ", my name is " + _name;
}

double MyLibrary::add(double a, double b) const {
    return a + b;
}
