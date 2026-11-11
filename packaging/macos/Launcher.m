#import <Cocoa/Cocoa.h>

@interface DotjarDelegate : NSObject <NSApplicationDelegate>
@property NSWindow *window;
@property NSTask *task;
@end

@implementation DotjarDelegate
- (NSTextField *)label:(NSString *)text y:(CGFloat)y size:(CGFloat)size color:(NSColor *)color {
    NSTextField *label = [NSTextField labelWithString:text];
    label.font = [NSFont systemFontOfSize:size];
    label.textColor = color;
    label.alignment = NSTextAlignmentCenter;
    label.frame = NSMakeRect(30, y, 360, 24);
    return label;
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    NSView *content = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 420, 300)];
    content.wantsLayer = YES;
    content.layer.backgroundColor = [NSColor colorWithSRGBRed:0.055 green:0.094 blue:0.167 alpha:1].CGColor;
    NSImageView *brand = [[NSImageView alloc] initWithFrame:NSMakeRect(30, 100, 360, 180)];
    brand.image = [[NSImage alloc] initWithContentsOfURL:[[NSBundle mainBundle] URLForResource:@"brand-lockup" withExtension:@"png"]];
    brand.imageScaling = NSImageScaleProportionallyUpOrDown;
    [content addSubview:brand];
    [content addSubview:[self label:@"正在打开…" y:78 size:14 color:[NSColor colorWithSRGBRed:0.85 green:0.90 blue:1 alpha:1]]];
    [content addSubview:[self label:@"首次打开会准备运行环境，请稍候。" y:51 size:12 color:[NSColor colorWithSRGBRed:0.58 green:0.65 blue:0.77 alpha:1]]];
    NSProgressIndicator *progress = [[NSProgressIndicator alloc] initWithFrame:NSMakeRect(100, 28, 220, 8)];
    progress.style = NSProgressIndicatorStyleBar;
    progress.indeterminate = YES;
    [progress startAnimation:nil];
    [content addSubview:progress];
    self.window = [[NSWindow alloc] initWithContentRect:content.frame styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"dotjar";
    self.window.contentView = content;
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];

    NSURL *resources = [NSBundle mainBundle].resourceURL;
    NSURL *executable = [NSBundle mainBundle].executableURL;
    if (!resources || !executable) { [self fail:@"安装文件不完整，请重新安装 dotjar。"]; return; }
    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [[executable URLByDeletingLastPathComponent] URLByAppendingPathComponent:@"node"];
    task.arguments = @[[resources URLByAppendingPathComponent:@"host/src/update/desktop.js"].path, resources.path];
    // Ignore developer test directories and Node injection settings in Finder.
    NSMutableDictionary *env = [[NSProcessInfo processInfo].environment mutableCopy];
    for (NSString *key in env.allKeys) {
        if ([key hasPrefix:@"DOTJAR_"] || [@[@"STRATA_HOME", @"NODE_OPTIONS", @"NODE_PATH", @"ELECTRON_RUN_AS_NODE"] containsObject:key]) [env removeObjectForKey:key];
    }
    env[@"HOME"] = [NSFileManager defaultManager].homeDirectoryForCurrentUser.path;
    task.environment = env;
    task.standardOutput = [NSFileHandle fileHandleWithNullDevice];
    NSPipe *errors = [NSPipe pipe];
    task.standardError = errors;
    task.terminationHandler = ^(NSTask *process) {
        NSString *message = [[NSString alloc] initWithData:[errors.fileHandleForReading readDataToEndOfFile] encoding:NSUTF8StringEncoding] ?: @"";
        dispatch_async(dispatch_get_main_queue(), ^{
            if (process.terminationStatus == 0) [NSApp terminate:nil];
            else [self fail:message.length ? [message substringToIndex:MIN(message.length, 2000)] : @"打开失败，请稍后重试。"];
        });
    };
    self.task = task;
    NSError *error;
    if (![task launchAndReturnError:&error]) [self fail:[@"无法启动运行环境：" stringByAppendingString:error.localizedDescription]];
}
- (void)fail:(NSString *)message {
    [self.window orderOut:nil];
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"dotjar 暂时无法打开";
    alert.informativeText = message;
    alert.alertStyle = NSAlertStyleWarning;
    [alert addButtonWithTitle:@"关闭"];
    [alert addButtonWithTitle:@"安装与更新帮助"];
    if ([alert runModal] == NSAlertSecondButtonReturn) {
        [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:@"https://github.com/yx0716/dotjar/blob/main/docs/updates.md"]];
    }
    [NSApp terminate:nil];
}
@end

int main(void) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        DotjarDelegate *delegate = [[DotjarDelegate alloc] init];
        app.delegate = delegate;
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        [app run];
    }
    return 0;
}
