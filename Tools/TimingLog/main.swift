// pocket-timing-log — print the exact click schedule a plan produces, as CSV.
//
// Use it to inspect the clock offline, and later to compare against a
// wired loopback recording from a real iPad (M0-01).
//
//   swift run pocket-timing-log --bpm 120 --meter 7/8 --grouping 2+2+3 \
//       --subdivision 1 --count-in 1 --seconds 10 --sample-rate 48000

import PocketDomain

struct Options {
    var bpm = 120.0
    var meter = "4/4"
    var grouping: [Int]?
    var subdivision = 1
    var beatUnit: String?
    var countIn = 0
    var seconds = 8.0
    var sampleRate = 48_000
}

func usage() -> Never {
    print("""
    usage: pocket-timing-log [--bpm N] [--meter N/D] [--grouping 2+2+3]
                             [--subdivision 1-8] [--beat-unit quarter|eighth|dotted-quarter|half]
                             [--count-in BARS] [--seconds S] [--sample-rate HZ]
    """)
    exit(2)
}

func parse(_ arguments: [String]) -> Options {
    var options = Options()
    var iterator = arguments.makeIterator()
    while let flag = iterator.next() {
        guard let value = iterator.next() else { usage() }
        switch flag {
        case "--bpm": options.bpm = Double(value) ?? { usage() }()
        case "--meter": options.meter = value
        case "--grouping": options.grouping = value.split(separator: "+").map { Int($0) ?? { usage() }() }
        case "--subdivision": options.subdivision = Int(value) ?? { usage() }()
        case "--beat-unit": options.beatUnit = value
        case "--count-in": options.countIn = Int(value) ?? { usage() }()
        case "--seconds": options.seconds = Double(value) ?? { usage() }()
        case "--sample-rate": options.sampleRate = Int(value) ?? { usage() }()
        default: usage()
        }
    }
    return options
}

let options = parse(Array(CommandLine.arguments.dropFirst()))
let meterParts = options.meter.split(separator: "/").compactMap { Int($0) }
guard meterParts.count == 2 else { usage() }

do {
    let meter = try Meter(meterParts[0], meterParts[1], grouping: options.grouping)
    let beatUnit: NoteValue
    switch options.beatUnit {
    case nil: beatUnit = meter.defaultBeatUnit
    case "quarter": beatUnit = .quarter
    case "eighth": beatUnit = .eighth
    case "dotted-quarter": beatUnit = .dottedQuarter
    case "half": beatUnit = .half
    default: usage()
    }
    let pattern = try ClickPattern(meter: meter, subdivision: options.subdivision)
    let tempo = try Tempo(bpm: options.bpm, beatUnit: beatUnit)
    let plan = try PlaybackPlan.click(pattern: pattern, tempo: tempo, countInBars: options.countIn, sampleRate: options.sampleRate)
    let end = Int64((options.seconds * Double(options.sampleRate)).rounded())

    print("# \(meter), \(tempo), subdivision \(options.subdivision), count-in \(options.countIn), \(options.sampleRate) Hz")
    print("frame,seconds,bar,unit,sub,level,role")
    for event in plan.events(in: 0..<end) {
        let seconds = Double(event.frame) / Double(options.sampleRate)
        let secondsText = String(Int((seconds * 1_000_000).rounded())).leftPadded(to: 7)
        let formatted = secondsText.dropLast(6) + "." + secondsText.suffix(6)
        print("\(event.frame),\(formatted),\(event.bar),\(event.unit),\(event.subdivision),\(event.level),\(event.role.rawValue)")
    }
} catch {
    print("error: \(error)")
    exit(1)
}

extension String {
    func leftPadded(to length: Int) -> String {
        count >= length ? self : String(repeating: "0", count: length - count) + self
    }
}

#if canImport(Glibc)
import Glibc
#elseif canImport(Darwin)
import Darwin
#endif
