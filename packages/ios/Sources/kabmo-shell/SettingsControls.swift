#if canImport(UIKit)
import UIKit
import KabmoShell

/// The pieces the settings screen is assembled from.
///
/// Split out because the screen itself is wiring plus behaviour, and the layout
/// builders were most of the file. They are pure view construction — no state, no
/// callbacks except the ones passed in — which is also what makes them the part a
/// reader can skim.
enum SettingsControls {

  static func label(_ text: String) -> UILabel {
    let view = UILabel()
    view.text = text
    view.font = .systemFont(ofSize: 12, weight: .medium)
    view.textColor = Palette.ink
    return view
  }

  static func hint(_ text: String) -> UILabel {
    let view = UILabel()
    view.text = text
    view.font = .systemFont(ofSize: 11)
    view.textColor = Palette.inkFaint
    view.numberOfLines = 0
    return view
  }

  static func spacer(_ height: CGFloat) -> UIView {
    let view = UIView()
    view.heightAnchor.constraint(equalToConstant: height).isActive = true
    return view
  }

  /// A text field in a bordered box.
  ///
  /// The box is a wrapper rather than the field's own `borderStyle`: a `UITextField`
  /// draws its border on the field's frame, which leaves no room for the inset the
  /// console's own fields have.
  static func fieldBox(_ field: UITextField) -> UIView {
    field.borderStyle = .none
    field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
    field.leftViewMode = .always
    field.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
    field.rightViewMode = .always
    field.heightAnchor.constraint(equalToConstant: 44).isActive = true

    let box = UIView()
    box.backgroundColor = Palette.field
    box.layer.cornerRadius = 8
    box.layer.borderWidth = 1
    box.layer.borderColor = Palette.hairline.cgColor
    box.addSubview(field)
    field.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      field.topAnchor.constraint(equalTo: box.topAnchor),
      field.bottomAnchor.constraint(equalTo: box.bottomAnchor),
      field.leadingAnchor.constraint(equalTo: box.leadingAnchor),
      field.trailingAnchor.constraint(equalTo: box.trailingAnchor),
    ])
    return box
  }

  /// The cleartext trade, stated on screen rather than buried in a README: a user who
  /// types an `http://` LAN address is sending their password in the open, and loses
  /// voice dictation without being told why.
  static func cleartextNotice() -> UIView {
    let view = UILabel()
    view.text = "Plain http: your password and session cookie travel unencrypted on this "
      + "network, and voice dictation is unavailable (the browser withholds the microphone "
      + "outside a secure context)."
    view.font = .systemFont(ofSize: 11)
    view.textColor = Palette.warningInk
    view.numberOfLines = 0
    view.backgroundColor = Palette.warningFill
    view.layer.cornerRadius = 8
    view.layer.borderWidth = 1
    view.layer.borderColor = Palette.warningHairline.cgColor
    view.layer.masksToBounds = true
    view.setContentHuggingPriority(.defaultLow, for: .horizontal)
    return inset(view, by: 12)
  }

  static func inset(_ view: UIView, by padding: CGFloat) -> UIView {
    let wrapper = UIView()
    wrapper.addSubview(view)
    view.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      view.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: padding),
      view.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor, constant: -padding),
      view.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: padding),
      view.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -padding),
    ])
    return wrapper
  }

  /// A flat button in the console's own palette.
  ///
  /// `UIButton.Configuration` is cleared first: the system style tints the title with
  /// the app's accent colour, and this app has none — the console is monochrome plus
  /// a signal red for failures.
  static func style(_ button: UIButton, filled: Bool) -> UIButton {
    button.configuration = nil
    button.setTitleColor(filled ? Palette.paper : Palette.ink, for: .normal)
    button.setTitleColor((filled ? Palette.paper : Palette.ink).withAlphaComponent(0.4), for: .disabled)
    button.titleLabel?.font = .systemFont(ofSize: 13, weight: .medium)
    button.backgroundColor = filled ? Palette.ink : Palette.field
    button.layer.cornerRadius = 8
    button.layer.borderWidth = filled ? 0 : 1
    button.layer.borderColor = Palette.hairline.cgColor
    button.contentEdgeInsets = UIEdgeInsets(top: 9, left: 14, bottom: 9, right: 14)
    button.heightAnchor.constraint(equalToConstant: 38).isActive = true
    return button
  }
}
#endif
