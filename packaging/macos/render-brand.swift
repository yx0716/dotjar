import AppKit

// Code-native brand assets: a four-point star remains crisp at Dock sizes.
let navy = NSColor(srgbRed: 0.055, green: 0.094, blue: 0.167, alpha: 1)
let blue = NSColor(srgbRed: 0.69, green: 0.81, blue: 1, alpha: 1)
func star(_ center: NSPoint, _ radius: CGFloat) {
    let p = NSBezierPath()
    let x = center.x, y = center.y, r = radius
    p.move(to: NSPoint(x: x, y: y+r))
    p.curve(to: NSPoint(x: x+r, y: y), controlPoint1: NSPoint(x:x+r*0.28,y:y+r*0.28), controlPoint2:NSPoint(x:x+r*0.28,y:y+r*0.28))
    p.curve(to: NSPoint(x: x, y: y-r), controlPoint1: NSPoint(x:x+r*0.28,y:y-r*0.28), controlPoint2:NSPoint(x:x+r*0.28,y:y-r*0.28))
    p.curve(to: NSPoint(x: x-r, y: y), controlPoint1: NSPoint(x:x-r*0.28,y:y-r*0.28), controlPoint2:NSPoint(x:x-r*0.28,y:y-r*0.28))
    p.curve(to: NSPoint(x: x, y: y+r), controlPoint1: NSPoint(x:x-r*0.28,y:y+r*0.28), controlPoint2:NSPoint(x:x-r*0.28,y:y+r*0.28))
    p.close()
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow(); shadow.shadowColor = blue.withAlphaComponent(0.5); shadow.shadowBlurRadius = r*0.35; shadow.set()
    blue.setFill(); p.fill()
    NSGraphicsContext.restoreGraphicsState()
}
func render(_ size: NSSize, _ name: String, _ draw: () -> Void) {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:Int(size.width),pixelsHigh:Int(size.height),bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
    let context = NSGraphicsContext(bitmapImageRep:bitmap)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
    draw(); context.flushGraphics(); NSGraphicsContext.restoreGraphicsState()
    try! bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[1]).appendingPathComponent(name))
}
render(NSSize(width:1024,height:1024), "icon-star.png") {
    navy.setFill(); NSBezierPath(roundedRect:NSRect(x:100,y:100,width:824,height:824),xRadius:180,yRadius:180).fill()
    star(NSPoint(x:512,y:512), 226)
}
render(NSSize(width:720,height:360), "brand-lockup.png") {
    navy.setFill(); NSRect(x:0,y:0,width:720,height:360).fill()
    star(NSPoint(x:360,y:265), 42)
    let attrs:[NSAttributedString.Key:Any] = [.font:NSFont(name:"Georgia",size:100) ?? NSFont.systemFont(ofSize:100),.foregroundColor:NSColor(srgbRed:0.96,green:0.97,blue:1,alpha:1)]
    let title = "dotjar" as NSString
    let width = title.size(withAttributes:attrs).width
    title.draw(at:NSPoint(x:(720-width)/2,y:80),withAttributes:attrs)
}
